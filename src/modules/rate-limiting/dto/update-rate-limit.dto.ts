import {
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RateLimitTier } from '../enums/rate-limit.enum';

/** Hard cap for a finite request quota. */
export const MAX_REQUESTS_CAP = 1_000_000;

/**
 * Request body to create or update a rate limit configuration for a tier.
 */
export class UpdateRateLimitDto {
  @ApiProperty({ enum: RateLimitTier, description: 'Target subscription tier' })
  @IsEnum(RateLimitTier)
  tier!: RateLimitTier;

  @ApiProperty({
    description:
      'Maximum requests per window (1..1000000). Pass unlimited: true for an unlimited quota — an explicit boolean instead of the old magic -1, which has caused the service to silently block every request.',
    example: 100,
    minimum: 1,
    maximum: MAX_REQUESTS_CAP,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_REQUESTS_CAP)
  maxRequests!: number;

  @ApiPropertyOptional({
    description:
      'When true, the tier (or endpoint pattern) has an unlimited quota. Rows may still carry the legacy -1 sentinel in the database; it is normalised back to unlimited on read.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  unlimited?: boolean;

  @ApiPropertyOptional({
    description: 'Window size in seconds',
    example: 60,
    default: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  windowSizeSeconds?: number;

  @ApiPropertyOptional({
    description: 'Endpoint pattern (e.g. /api/trading/*)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  endpointPattern?: string;

  @ApiPropertyOptional({
    description: 'Whether this tier is enabled',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Required true confirmation when setting enabled: false. A disabled tier stores a zero quota and blocks every request to it, which previously happened silently and could take an endpoint offline with one unconfirmed request.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  disableConfirmation?: boolean;
}

/**
 * Response DTO for a rate limit configuration.
 */
export class RateLimitConfigResponseDto {
  @ApiProperty({ enum: RateLimitTier })
  tier!: RateLimitTier;

  @ApiProperty()
  maxRequests!: number;

  @ApiProperty()
  windowSizeSeconds!: number;

  @ApiProperty({ nullable: true })
  endpointPattern?: string | null;

  @ApiProperty()
  enabled!: boolean;
}
