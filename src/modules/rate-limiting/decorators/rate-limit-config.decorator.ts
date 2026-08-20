import { SetMetadata } from '@nestjs/common';
import { RateLimitTier } from '../enums/rate-limit.enum';

export const RATE_LIMIT_CONFIG_KEY = 'rate-limit-config';

export interface RateLimitOverride {
  /** Override the max requests for this route specifically. */
  maxRequests?: number;
  /** Override the tier used for this route. */
  tier?: RateLimitTier;
  /** Override the window size in seconds. */
  windowSizeSeconds?: number;
}

/**
 * Apply per-route rate limit overrides. These values take precedence over
 * the tier-based defaults when the guard evaluates this route.
 *
 * @example
 *   @RateLimitConfig({ maxRequests: 10, windowSizeSeconds: 1 })
 *   @Post('trade')
 *   placeOrder() { ... }
 */
export const RateLimitConfig = (override: RateLimitOverride) =>
  SetMetadata(RATE_LIMIT_CONFIG_KEY, override);
