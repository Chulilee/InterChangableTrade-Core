import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  RateLimitTier,
  SlidingWindowStrategy,
  DEFAULT_TIER_QUOTAS,
  DEFAULT_WINDOW_SIZE_SECS,
  RATE_LIMIT_KEY_PREFIX,
} from './enums/rate-limit.enum';
import { RateLimitConfig } from './entities/rate-limit-config.entity';

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

/**
 * Per-endpoint override entry (cached from DB).
 */
interface EndpointOverride {
  endpointPattern: string;
  maxRequests: number;
  windowSizeSeconds: number;
}

/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses a sorted set (ZSET) per key to implement a true sliding window:
 *   1. On each request, add a score = current timestamp.
 *   2. Remove all entries older than (now - windowSize).
 *   3. Count remaining entries → current usage.
 *   4. If usage >= limit → reject.
 *
 * This avoids the "burst at window boundary" problem of fixed windows.
 */
@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);

  /** In-memory cache of tier quotas, refreshed from DB on init and on admin update. */
  private tierQuotas: Map<
    string,
    { maxRequests: number; windowSizeSeconds: number }
  > = new Map();

  /** In-memory cache of endpoint-specific overrides. */
  private endpointOverrides: EndpointOverride[] = [];

  /** Strategy — configurable via env. */
  private readonly strategy: SlidingWindowStrategy;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(RateLimitConfig)
    private readonly configRepo: Repository<RateLimitConfig>,
    private readonly configService: ConfigService,
  ) {
    this.strategy =
      (this.configService.get('rateLimit.strategy') as SlidingWindowStrategy) ??
      SlidingWindowStrategy.SLIDING_WINDOW;
  }

  async onModuleInit(): Promise<void> {
    await this.loadConfigFromDb();
  }

  // ----------------------------------------------------------------
  //  Public API
  // ----------------------------------------------------------------

  /**
   * Check whether a request should be allowed. This is the main entry point
   * called by the guard.
   *
   * @param key       Unique identifier (e.g. userId, IP address, API key).
   * @param tier      User tier (free / premium / enterprise).
   * @param endpoint  Request path for endpoint-specific overrides.
   */
  async check(
    key: string,
    tier: RateLimitTier,
    endpoint?: string,
  ): Promise<RateLimitResult> {
    const { maxRequests, windowSizeSeconds } = this.getEffectiveLimits(
      tier,
      endpoint,
    );

    // Enterprise tier: unlimited
    if (!isFinite(maxRequests)) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetSeconds: 0,
        retryAfterSeconds: 0,
      };
    }

    const redisKey = `${RATE_LIMIT_KEY_PREFIX}${key}:${tier}:${endpoint ?? 'global'}`;
    const now = Date.now();
    const windowMs = windowSizeSeconds * 1000;

    let result: RateLimitResult;

    if (this.strategy === SlidingWindowStrategy.SLIDING_WINDOW) {
      result = await this.slidingWindowCheck(
        redisKey,
        now,
        windowMs,
        maxRequests,
      );
    } else {
      result = await this.fixedWindowCheck(
        redisKey,
        now,
        windowMs,
        maxRequests,
      );
    }

    return result;
  }

  /**
   * Manually refresh configuration from the database (called after admin updates).
   */
  async refreshConfig(): Promise<void> {
    await this.loadConfigFromDb();
  }

  /**
   * Get current configuration for a tier.
   */
  async getConfig(tier: RateLimitTier): Promise<RateLimitConfig | null> {
    return this.configRepo.findOne({ where: { tier } });
  }

  /**
   * Get all configurations.
   */
  async getAllConfigs(): Promise<RateLimitConfig[]> {
    return this.configRepo.find({ order: { tier: 'ASC' } });
  }

  /**
   * Create or update a tier configuration. Also updates the in-memory cache.
   */
  async upsertConfig(params: {
    tier: RateLimitTier;
    maxRequests: number;
    windowSizeSeconds?: number;
    endpointPattern?: string;
    enabled?: boolean;
  }): Promise<RateLimitConfig> {
    let config = await this.configRepo.findOne({
      where: { tier: params.tier },
    });

    if (config) {
      config.maxRequests = params.maxRequests;
      if (params.windowSizeSeconds !== undefined) {
        config.windowSizeSeconds = params.windowSizeSeconds;
      }
      if (params.endpointPattern !== undefined) {
        config.endpointPattern = params.endpointPattern;
      }
      if (params.enabled !== undefined) {
        config.enabled = params.enabled;
      }
    } else {
      config = this.configRepo.create({
        tier: params.tier,
        maxRequests: params.maxRequests,
        windowSizeSeconds: params.windowSizeSeconds ?? DEFAULT_WINDOW_SIZE_SECS,
        endpointPattern: params.endpointPattern ?? null,
        enabled: params.enabled ?? true,
      });
    }

    const saved = await this.configRepo.save(config);
    await this.loadConfigFromDb();
    this.logger.log(
      `Rate limit config updated for tier ${params.tier}: ${params.maxRequests} reqs/${params.windowSizeSeconds ?? DEFAULT_WINDOW_SIZE_SECS}s`,
    );
    return saved;
  }

  /**
   * Get the current request count and remaining quota for a key (for introspection).
   */
  async getUsage(
    key: string,
    tier: RateLimitTier,
    endpoint?: string,
  ): Promise<{
    used: number;
    limit: number;
    remaining: number;
    resetSeconds: number;
  }> {
    const { maxRequests, windowSizeSeconds } = this.getEffectiveLimits(
      tier,
      endpoint,
    );

    if (!isFinite(maxRequests)) {
      return { used: 0, limit: Infinity, remaining: Infinity, resetSeconds: 0 };
    }

    const redisKey = `${RATE_LIMIT_KEY_PREFIX}${key}:${tier}:${endpoint ?? 'global'}`;
    const now = Date.now();
    const windowMs = windowSizeSeconds * 1000;

    // Clean up old entries and count
    const minScore = now - windowMs;
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(redisKey, '-inf', String(minScore));
    pipeline.zcard(redisKey);
    const results = await pipeline.exec();

    const count = (results?.[1]?.[1] as number) ?? 0;

    return {
      used: count,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetSeconds: windowSizeSeconds,
    };
  }

  /**
   * Manually add entries to bypass the limiter for critical system operations.
   */
  async clearKey(
    key: string,
    tier: RateLimitTier,
    endpoint?: string,
  ): Promise<void> {
    const redisKey = `${RATE_LIMIT_KEY_PREFIX}${key}:${tier}:${endpoint ?? 'global'}`;
    await this.redis.del(redisKey);
  }

  // ----------------------------------------------------------------
  //  Sliding Window Implementation
  // ----------------------------------------------------------------

  private async slidingWindowCheck(
    redisKey: string,
    now: number,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitResult> {
    const minScore = now - windowMs;
    const transaction = this.redis.pipeline();
    // Remove expired entries
    transaction.zremrangebyscore(redisKey, '-inf', String(minScore));
    // Add current request
    transaction.zadd(
      redisKey,
      String(now),
      `${now}:${Math.random().toString(36).slice(2, 8)}`,
    );
    // Set TTL so Redis auto-cleans
    transaction.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
    // Count current window
    transaction.zcard(redisKey);

    const results = await transaction.exec();

    // zcard is the 4th command (index 3)
    const currentCount = (results?.[3]?.[1] as number) ?? 0;
    const allowed = currentCount <= maxRequests;
    const remaining = Math.max(0, maxRequests - currentCount);

    // Get the oldest entry to calculate reset time
    const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const resetSeconds =
      oldest.length >= 2
        ? Math.ceil((Number(oldest[1]) + windowMs - now) / 1000)
        : Math.ceil(windowMs / 1000);

    return {
      allowed,
      limit: maxRequests,
      remaining,
      resetSeconds: Math.max(0, resetSeconds),
      retryAfterSeconds: allowed ? 0 : resetSeconds,
    };
  }

  // ----------------------------------------------------------------
  //  Fixed Window Implementation (alternative strategy)
  // ----------------------------------------------------------------

  private async fixedWindowCheck(
    redisKey: string,
    now: number,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitResult> {
    // Derive window start from current time
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowKey = `${redisKey}:${windowStart}`;

    const transaction = this.redis.pipeline();
    transaction.incr(windowKey);
    transaction.expire(windowKey, Math.ceil(windowMs / 1000) + 1);

    const results = await transaction.exec();
    const currentCount = (results?.[0]?.[1] as number) ?? 1;
    const allowed = currentCount <= maxRequests;
    const remaining = Math.max(0, maxRequests - currentCount);
    const resetSeconds = Math.ceil((windowStart + windowMs - now) / 1000);

    return {
      allowed,
      limit: maxRequests,
      remaining,
      resetSeconds: Math.max(0, resetSeconds),
      retryAfterSeconds: allowed ? 0 : resetSeconds,
    };
  }

  // ----------------------------------------------------------------
  //  Configuration Helpers
  // ----------------------------------------------------------------

  private async loadConfigFromDb(): Promise<void> {
    try {
      const configs = await this.configRepo.find();

      this.tierQuotas.clear();
      this.endpointOverrides = [];

      for (const cfg of configs) {
        if (!cfg.enabled) {
          // Disabled tier gets 0 quota (effectively blocked)
          this.tierQuotas.set(cfg.tier, {
            maxRequests: 0,
            windowSizeSeconds: cfg.windowSizeSeconds,
          });
        } else {
          this.tierQuotas.set(cfg.tier, {
            maxRequests: cfg.maxRequests,
            windowSizeSeconds: cfg.windowSizeSeconds,
          });
        }

        if (cfg.endpointPattern) {
          this.endpointOverrides.push({
            endpointPattern: cfg.endpointPattern,
            maxRequests: cfg.maxRequests,
            windowSizeSeconds: cfg.windowSizeSeconds,
          });
        }
      }

      this.logger.debug(`Loaded ${configs.length} rate limit configs from DB`);
    } catch {
      this.logger.warn(
        'Failed to load rate limit configs from DB, using defaults',
      );
    }
  }

  private getEffectiveLimits(
    tier: RateLimitTier,
    endpoint?: string,
  ): { maxRequests: number; windowSizeSeconds: number } {
    // Check for endpoint-specific override first
    if (endpoint) {
      const override = this.endpointOverrides.find((o) =>
        this.pathMatchesPattern(endpoint, o.endpointPattern),
      );
      if (override) {
        return {
          maxRequests: override.maxRequests,
          windowSizeSeconds: override.windowSizeSeconds,
        };
      }
    }

    // Fall back to tier config
    const tierConfig = this.tierQuotas.get(tier);
    if (tierConfig) {
      return tierConfig;
    }

    // Fall back to defaults
    return {
      maxRequests:
        DEFAULT_TIER_QUOTAS[tier] ?? DEFAULT_TIER_QUOTAS[RateLimitTier.FREE],
      windowSizeSeconds: DEFAULT_WINDOW_SIZE_SECS,
    };
  }

  /**
   * Simple glob-style pattern matching for endpoint paths.
   * Supports '*' as a wildcard that matches any characters.
   */
  private pathMatchesPattern(path: string, pattern: string): boolean {
    if (!pattern) return false;
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(path);
  }
}
