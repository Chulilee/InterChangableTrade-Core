import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseEnumPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RateLimitService } from './rate-limit.service';
import {
  UpdateRateLimitDto,
  RateLimitConfigResponseDto,
} from './dto/update-rate-limit.dto';
import { RateLimitTier } from './enums/rate-limit.enum';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../auth/decorators/current-user.decorator';

/**
 * Admin-only controller for managing rate limit configuration at runtime.
 *
 * All endpoints are protected by JWT authentication and require the `admin`
 * role. Rate-limit bypass is intentionally *not* applied here — admin writes
 * are subject to the same rate limits as every other request.
 */
@ApiTags('Rate Limiting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('rate-limits')
export class RateLimitController {
  constructor(private readonly rateLimitService: RateLimitService) {}

  /**
   * List all rate limit configurations.
   */
  @Get()
  @ApiOperation({ summary: 'List all rate limit configurations' })
  async getAllConfigs(): Promise<RateLimitConfigResponseDto[]> {
    const configs = await this.rateLimitService.getAllConfigs();
    return configs.map((c) => ({
      tier: c.tier,
      maxRequests: c.maxRequests,
      windowSizeSeconds: c.windowSizeSeconds,
      endpointPattern: c.endpointPattern,
      enabled: c.enabled,
    }));
  }

  /**
   * Get the configuration for a specific tier.
   */
  @Get(':tier')
  @ApiOperation({ summary: 'Get rate limit configuration for a tier' })
  async getConfig(
    @Param('tier', new ParseEnumPipe(RateLimitTier)) tier: RateLimitTier,
  ): Promise<RateLimitConfigResponseDto | null> {
    const config = await this.rateLimitService.getConfig(tier);
    if (!config) return null;
    return {
      tier: config.tier,
      maxRequests: config.maxRequests,
      windowSizeSeconds: config.windowSizeSeconds,
      endpointPattern: config.endpointPattern,
      enabled: config.enabled,
    };
  }

  /**
   * Create or update a rate limit configuration for a tier.
   *
   * Rejects `endpointPattern: '*'` (would disable rate limiting globally) and
   * `maxRequests` outside the allowed range.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a rate limit configuration' })
  async upsertConfig(
    @Body() dto: UpdateRateLimitDto,
  ): Promise<RateLimitConfigResponseDto> {
    const config = await this.rateLimitService.upsertConfig({
      tier: dto.tier,
      maxRequests: dto.maxRequests,
      windowSizeSeconds: dto.windowSizeSeconds,
      endpointPattern: dto.endpointPattern,
      enabled: dto.enabled,
      unlimited: dto.unlimited,
      disableConfirmation: dto.disableConfirmation,
    });

    return {
      tier: config.tier,
      maxRequests: config.maxRequests,
      windowSizeSeconds: config.windowSizeSeconds,
      endpointPattern: config.endpointPattern,
      enabled: config.enabled,
    };
  }

  /**
   * Check current usage for a specific key and tier.
   *
   * Non-admin callers can only query their own key; the `key` query param is
   * namespaced to the caller's user ID. Admins may query any key.
   */
  @Get('usage/:tier')
  @ApiOperation({ summary: 'Check current rate limit usage for a key' })
  async getUsage(
    @Param('tier', new ParseEnumPipe(RateLimitTier)) tier: RateLimitTier,
    @Query('key') key: string,
    @Query('endpoint') endpoint?: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const effectiveKey = this.resolveKey(key, user);
    return this.rateLimitService.getUsage(effectiveKey, tier, endpoint);
  }

  /**
   * Clear rate limit counters for a specific key (manual reset).
   *
   * Non-admin callers can only clear their own key; admins pass an explicit
   * `?all=true` to clear any key.
   */
  @Put('clear/:tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear rate limit counters for a key' })
  async clearKey(
    @Param('tier', new ParseEnumPipe(RateLimitTier)) tier: RateLimitTier,
    @Query('key') key: string,
    @Query('endpoint') endpoint?: string,
    @Query('all') all?: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const effectiveKey = this.resolveKey(key, user, all === 'true');
    await this.rateLimitService.clearKey(effectiveKey, tier, endpoint);
    return { success: true, message: `Cleared rate limit for ${effectiveKey}` };
  }

  /**
   * Force refresh the in-memory config cache from the database.
   */
  @Put('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh rate limit config cache from database' })
  async refreshConfig() {
    await this.rateLimitService.refreshConfig();
    return { success: true, message: 'Rate limit configuration refreshed' };
  }

  /**
   * Resolve the effective rate-limit key.
   *
   * Non-admin callers are restricted to their own user-scoped key.
   * Admins may clear/query any key when `all=true` is passed; otherwise they
   * are limited to their own key as well.
   */
  private resolveKey(
    key: string | undefined,
    user: AuthenticatedUser,
    allowAny: boolean = false,
  ): string {
    if (user.role === UserRole.ADMIN && allowAll) {
      return key ?? `user:${user.id}`;
    }
    return `user:${user.id}`;
  }
}
