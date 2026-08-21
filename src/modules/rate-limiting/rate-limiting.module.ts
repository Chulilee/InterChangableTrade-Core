import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { RateLimitController } from './rate-limit.controller';
import { RateLimitConfig } from './entities/rate-limit-config.entity';

/**
 * Rate Limiting & Throttling Module
 *
 * Provides Redis-backed sliding window rate limiting with:
 *  - Per-user tier-based quotas (free / premium / enterprise)
 *  - IP-based limiting for unauthenticated requests
 *  - Per-endpoint overrides
 *  - Rate limit headers (X-RateLimit-*)
 *  - Admin endpoints for runtime configuration
 *  - Bypass decorator for critical system operations
 *
 * Register `RateLimitGuard` globally in `main.ts` to enforce limits
 * on all routes.
 *
 * @example main.ts
 *   app.useGlobalGuards(app.get(RateLimitGuard));
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RateLimitConfig])],
  controllers: [RateLimitController],
  providers: [RateLimitService, RateLimitGuard],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitingModule {}
