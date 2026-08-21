import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
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
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Filter by blocked status' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  transactionsBlocked?: boolean;
}
