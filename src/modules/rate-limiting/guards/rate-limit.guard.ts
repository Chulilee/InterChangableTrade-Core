import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimitService } from '../rate-limit.service';
import { RateLimitTier, RATE_LIMIT_HEADERS } from '../enums/rate-limit.enum';
import { RATE_LIMIT_BYPASS_KEY } from '../decorators/bypass-rate-limit.decorator';
import {
  RATE_LIMIT_CONFIG_KEY,
  RateLimitOverride,
} from '../decorators/rate-limit-config.decorator';

/**
 * Default tier for unauthenticated requests.
 */
const DEFAULT_UNAUTHENTICATED_TIER = RateLimitTier.FREE;

/**
 * Header that may carry the authenticated user's subscription tier.
 */
const TIER_HEADER = 'x-user-tier';

/**
 * NestJS guard implementing comprehensive rate limiting.
 *
 * Behaviour:
 *  1. Check if the route is decorated with @BypassRateLimit → skip.
 *  2. Extract the rate limit key (userId, API key, or IP).
 *  3. Determine the user's tier (from request.user, header, or default to FREE).
 *  4. Call RateLimitService.check() with the sliding window algorithm.
 *  5. Set X-RateLimit-* headers on the response.
 *  6. Throw 429 Too Many Requests with Retry-After when limit exceeded.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check bypass decorator
    const bypass = this.reflector.getAllAndOverride<boolean>(
      RATE_LIMIT_BYPASS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypass) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // 2. Extract rate limit key
    const key = this.extractKey(request);

    // 3. Determine tier
    const tier = this.determineTier(request);

    // 4. Check for per-route override
    const override = this.reflector.getAllAndOverride<
      RateLimitOverride | undefined
    >(RATE_LIMIT_CONFIG_KEY, [context.getHandler(), context.getClass()]);

    const endpoint = request.path;

    // 5. Run rate limit check
    const result = await this.rateLimitService.check(key, tier, endpoint);

    // 5a. Apply per-route override if present (for maxRequests from decorator)
    let effectiveResult = result;
    if (override?.maxRequests !== undefined && isFinite(result.limit)) {
      const decoratorRemaining = Math.max(
        0,
        override.maxRequests - (result.limit - result.remaining),
      );
      effectiveResult = {
        ...result,
        limit: override.maxRequests,
        remaining: decoratorRemaining,
        allowed: decoratorRemaining > 0,
        retryAfterSeconds:
          decoratorRemaining > 0 ? 0 : result.retryAfterSeconds,
      };
    }

    // 6. Set response headers
    if (isFinite(effectiveResult.limit)) {
      response.setHeader(
        RATE_LIMIT_HEADERS.LIMIT,
        String(effectiveResult.limit),
      );
      response.setHeader(
        RATE_LIMIT_HEADERS.REMAINING,
        String(effectiveResult.remaining),
      );
      response.setHeader(
        RATE_LIMIT_HEADERS.RESET,
        String(effectiveResult.resetSeconds),
      );
      response.setHeader(
        RATE_LIMIT_HEADERS.POLICY,
        `${effectiveResult.limit};w=${effectiveResult.resetSeconds}`,
      );
    }

    // 7. Enforce limit
    if (!effectiveResult.allowed) {
      response.setHeader(
        RATE_LIMIT_HEADERS.RETRY_AFTER,
        String(effectiveResult.retryAfterSeconds),
      );

      this.logger.warn(
        `Rate limit exceeded for ${key} (tier=${tier}, endpoint=${endpoint}): ` +
          `${effectiveResult.limit} reqs/${effectiveResult.resetSeconds}s`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: effectiveResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Extract the rate limit identifier from the request.
   * Priority: userId > API key > IP address.
   */
  private extractKey(request: Request): string {
    // Authenticated user
    const user = (request as any).user;
    if (user?.id) {
      return `user:${user.id}`;
    }

    // API key from header
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      return `apikey:${apiKey}`;
    }

    // IP address (supports proxied requests)
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      'unknown';

    return `ip:${ip}`;
  }

  /**
   * Determine the user's subscription tier.
   * Priority: request.user.tier > x-user-tier header > FREE.
   */
  private determineTier(request: Request): RateLimitTier {
    const user = (request as any).user;
    if (user?.tier) {
      return user.tier as RateLimitTier;
    }

    const headerTier = request.headers[TIER_HEADER] as string | undefined;
    if (
      headerTier &&
      Object.values(RateLimitTier).includes(headerTier as RateLimitTier)
    ) {
      return headerTier as RateLimitTier;
    }

    return DEFAULT_UNAUTHENTICATED_TIER;
  }
}
