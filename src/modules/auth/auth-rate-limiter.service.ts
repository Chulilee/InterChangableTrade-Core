import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const FAILED_ATTEMPT_PREFIX = 'auth:fail:';
const LOCKOUT_PREFIX = 'auth:lock:';

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
