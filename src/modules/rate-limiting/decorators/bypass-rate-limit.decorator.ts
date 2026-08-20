import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_BYPASS_KEY = 'rate-limit-bypass';

/**
 * Marks a route or controller as exempt from rate limiting.
 * Use for critical system operations (health checks, webhooks, etc.).
 *
 * @example
 *   @BypassRateLimit()
 *   @Get('health')
 *   healthCheck() { return { status: 'ok' }; }
 */
export const BypassRateLimit = () => SetMetadata(RATE_LIMIT_BYPASS_KEY, true);
