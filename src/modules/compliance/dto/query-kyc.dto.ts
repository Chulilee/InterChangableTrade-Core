import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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
  @IsBoolean()
  @Type(() => Boolean)
  transactionsBlocked?: boolean;
}
