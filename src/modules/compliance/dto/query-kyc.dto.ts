import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { KycLevel } from '../enums/kyc-level.enum';
import { PaginationQueryDto } from '@app/common';

/**
 * Query parameters for listing KYC verifications with filtering.
 */
export class QueryKycDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: KycLevel, description: 'Filter by KYC level' })
  @IsOptional()
  @IsEnum(KycLevel)
  level?: KycLevel;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by region code' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'region must be an ISO 3166-1 alpha-2 country code (e.g. US, DE, JP)',
  })
  region?: string;

  @ApiPropertyOptional({ description: 'Filter by blocked status' })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    // Leave anything else untouched so `@IsBoolean()` rejects it.
    return value;
  })
  @IsBoolean()
  transactionsBlocked?: boolean;
}
