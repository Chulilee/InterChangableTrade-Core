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

/**
 * Request body to create or update a rate limit configuration for a tier.
 */
export class UpdateRateLimitDto {
  @ApiProperty({ enum: RateLimitTier, description: 'Target subscription tier' })
  @IsEnum(RateLimitTier)
  tier!: RateLimitTier;

  @ApiProperty({
    description: 'Maximum requests per window (use -1 for unlimited)',
    example: 100,
  })
  @IsInt()
  @Min(-1)
  maxRequests!: number;

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
