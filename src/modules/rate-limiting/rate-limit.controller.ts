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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RateLimitService } from './rate-limit.service';
import {
  UpdateRateLimitDto,
  RateLimitConfigResponseDto,
} from './dto/update-rate-limit.dto';
import { RateLimitTier } from './enums/rate-limit.enum';
import { BypassRateLimit } from './decorators/bypass-rate-limit.decorator';

/**
 * Admin-only controller for managing rate limit configuration at runtime.
 *
 * All endpoints here are exempt from rate limiting (admin operations)
 * and should be protected by authentication + admin role guard in production.
 */
@ApiTags('Rate Limiting')
@ApiBearerAuth()
@BypassRateLimit()
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
   */
  @Get('usage/:tier')
  @ApiOperation({ summary: 'Check current rate limit usage for a key' })
  async getUsage(
    @Param('tier', new ParseEnumPipe(RateLimitTier)) tier: RateLimitTier,
    @Query('key') key: string,
    @Query('endpoint') endpoint?: string,
  ) {
    return this.rateLimitService.getUsage(key, tier, endpoint);
  }

  /**
   * Clear rate limit counters for a specific key (manual reset).
   */
  @Put('clear/:tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear rate limit counters for a key' })
  async clearKey(
    @Param('tier', new ParseEnumPipe(RateLimitTier)) tier: RateLimitTier,
    @Query('key') key: string,
    @Query('endpoint') endpoint?: string,
  ) {
    await this.rateLimitService.clearKey(key, tier, endpoint);
    return { success: true, message: `Cleared rate limit for ${key}` };
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
}
