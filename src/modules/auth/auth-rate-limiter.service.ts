import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const FAILED_ATTEMPT_PREFIX = 'auth:fail:';
const LOCKOUT_PREFIX = 'auth:lock:';
const CHALLENGE_IP_PREFIX = 'auth:stellar-challenge:ip:';
const CHALLENGE_KEY_PREFIX = 'auth:stellar-challenge:key:';

/** Challenge-creation window. */
const CHALLENGE_WINDOW_SECS = 60;
/** Maximum challenge requests per source IP within the window. */
const CHALLENGE_MAX_PER_IP = 20;
/** Maximum challenge requests per public key within the window. */
const CHALLENGE_MAX_PER_KEY = 5;

/** Maximum consecutive failures before an account/IP is locked. */
const MAX_FAILURES = 5;
/** Failure counter TTL — resets after this many seconds with no attempts. */
const FAILURE_WINDOW_SECS = 300; // 5 minutes
/** How long a lockout lasts in seconds. */
const LOCKOUT_SECS = 900; // 15 minutes

/**
 * Redis-backed rate limiter for failed authentication attempts.
 *
 * Two keys per identifier:
 *  - `auth:fail:<id>`  — increment-on-failure counter (TTL: FAILURE_WINDOW_SECS)
 *  - `auth:lock:<id>`  — presence-of-lock flag (TTL: LOCKOUT_SECS)
 */
@Injectable()
export class AuthRateLimiterService {
  private readonly logger = new Logger(AuthRateLimiterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Returns true if the identifier (email address or IP) is currently locked out.
   */
  async isLockedOut(identifier: string): Promise<boolean> {
    const lockKey = `${LOCKOUT_PREFIX}${identifier}`;
    const locked = await this.redis.exists(lockKey).catch(() => 0);
    return locked === 1;
  }

  /**
   * Records a failed attempt. When the counter exceeds `MAX_FAILURES` within
   * `FAILURE_WINDOW_SECS`, a lockout is written.
   *
   * @returns the lockout duration in seconds if a lockout was just triggered,
   *          otherwise undefined.
   */
  async recordFailure(identifier: string): Promise<number | undefined> {
    const failKey = `${FAILED_ATTEMPT_PREFIX}${identifier}`;

    try {
      const count = await this.redis
        .multi()
        .incr(failKey)
        .expire(failKey, FAILURE_WINDOW_SECS)
        .exec();

      // The INCR result is the first command result [err, value].
      const failures = (count?.[0]?.[1] as number) ?? 0;

      if (failures >= MAX_FAILURES) {
        const lockKey = `${LOCKOUT_PREFIX}${identifier}`;
        await this.redis.set(lockKey, '1', 'EX', LOCKOUT_SECS);
        this.logger.warn(
          `Account/IP ${identifier} locked out after ${failures} failed attempts`,
        );
        return LOCKOUT_SECS;
      }
    } catch (err) {
      this.logger.error('Rate limiter Redis error', err);
    }

    return undefined;
  }

  /**
   * Enforces the challenge-creation quota for Stellar wallet login.
   *
   * Challenge creation is unauthenticated and writes a row, so it needs its
   * own limiter independent of failed password attempts. Both dimensions are
   * checked: a single IP cannot mass-create challenges, and a single public
   * key cannot be spammed (which would otherwise push out the legitimate
   * newest challenge under the supersession rule).
   *
   * Redis failures fail open, matching the rest of this service: a cache
   * outage must not make wallet login impossible.
   */
  async assertStellarChallengeAllowed(
    ipAddress: string | undefined,
    publicKey: string,
  ): Promise<void> {
    const checks: Array<{ key: string; limit: number }> = [];
    if (ipAddress) {
      checks.push({
        key: `${CHALLENGE_IP_PREFIX}${ipAddress}`,
        limit: CHALLENGE_MAX_PER_IP,
      });
    }
    checks.push({
      key: `${CHALLENGE_KEY_PREFIX}${publicKey}`,
      limit: CHALLENGE_MAX_PER_KEY,
    });

    for (const check of checks) {
      try {
        const count = await this.redis.incr(check.key);
        if (count === 1) {
          await this.redis.expire(check.key, CHALLENGE_WINDOW_SECS);
        }
        if (count > check.limit) {
          const ttl = await this.redis
            .ttl(check.key)
            .catch(() => CHALLENGE_WINDOW_SECS);
          throw new HttpException(
            `Too many Stellar challenge requests. Try again in ${Math.max(
              ttl,
              0,
            )} seconds.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      } catch (err) {
        if (
          err instanceof HttpException &&
          err.getStatus() === HttpStatus.TOO_MANY_REQUESTS
        ) {
          throw err;
        }
        this.logger.error('Challenge rate limiter Redis error', err);
      }
    }
  }

  /**
   * Clears the failure counter on successful authentication.
   * Also lifts a lockout if it was manually cleared (e.g., by an admin).
   */
  async clearFailures(identifier: string): Promise<void> {
    try {
      await this.redis.del(
        `${FAILED_ATTEMPT_PREFIX}${identifier}`,
        `${LOCKOUT_PREFIX}${identifier}`,
      );
    } catch (err) {
      this.logger.error('Failed to clear rate limit keys', err);
    }
  }

  /** Returns remaining seconds on an active lockout, or 0 if not locked. */
  async getLockoutTtl(identifier: string): Promise<number> {
    const lockKey = `${LOCKOUT_PREFIX}${identifier}`;
    const ttl = await this.redis.ttl(lockKey).catch(() => 0);
    return Math.max(0, ttl);
  }
}
