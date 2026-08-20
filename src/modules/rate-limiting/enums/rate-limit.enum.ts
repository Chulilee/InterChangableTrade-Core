/**
 * User subscription tiers that determine rate limit quotas.
 */
export enum RateLimitTier {
  FREE = 'free',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

/**
 * Supported sliding window algorithms.
 */
export enum SlidingWindowStrategy {
  /** Standard sliding window — counts requests in a rolling time window. */
  SLIDING_WINDOW = 'sliding_window',
  /** Fixed window — counts requests in a fixed time block (simpler, less precise). */
  FIXED_WINDOW = 'fixed_window',
}

/**
 * Determines how the rate limit key is derived for unauthenticated requests.
 */
export enum RateLimitIdentifier {
  IP = 'ip',
  API_KEY = 'api_key',
  USER = 'user',
}

/**
 * Default quotas per tier (requests per 60-second window).
 */
export const DEFAULT_TIER_QUOTAS: Record<RateLimitTier, number> = {
  [RateLimitTier.FREE]: 100,
  [RateLimitTier.PREMIUM]: 1000,
  [RateLimitTier.ENTERPRISE]: Infinity,
};

/**
 * Default window size in seconds.
 */
export const DEFAULT_WINDOW_SIZE_SECS = 60;

/**
 * Redis key prefix for rate limit data.
 */
export const RATE_LIMIT_KEY_PREFIX = 'rl:';

/**
 * Endpoints exempt from rate limiting (critical system operations).
 */
export const DEFAULT_BYPASS_PATHS: string[] = ['/api/health', '/api/docs'];

/**
 * Response header names for rate limit information.
 */
export const RATE_LIMIT_HEADERS = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset',
  RETRY_AFTER: 'Retry-After',
  POLICY: 'X-RateLimit-Policy',
} as const;
