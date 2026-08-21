import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ComplianceRegion } from '../enums/compliance-region.enum';

/**
 * DTO for creating or updating compliance configuration for a region.
 */
export class UpsertComplianceConfigDto {
  @ApiProperty({ enum: ComplianceRegion, description: 'Region for this config' })
  @IsEnum(ComplianceRegion)
  region: ComplianceRegion;

  @ApiProperty({ description: 'Display name for the region' })
  @IsString()
  displayName: string;

  @ApiPropertyOptional({ description: 'AML transaction threshold' })
  @IsOptional()
  @IsString()
  amlTransactionThreshold?: string;

  @ApiPropertyOptional({ description: 'Daily volume threshold' })
  @IsOptional()
  @IsString()
  dailyVolumeThreshold?: string;

  @ApiPropertyOptional({ description: 'Block threshold risk score (0-100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  blockThresholdScore?: number;

  @ApiPropertyOptional({ description: 'Enhanced due diligence score (0-100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  enhancedDueDiligenceScore?: number;

  @ApiPropertyOptional({ description: 'Flag threshold score (0-100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  flagThresholdScore?: number;

  @ApiPropertyOptional({ description: 'Max daily transactions before flagging' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDailyTransactions?: number;

  @ApiPropertyOptional({ description: 'KYC expiry in months' })
  @IsOptional()
  @IsInt()
  @Min(1)
  kycExpiryMonths?: number;

  @ApiPropertyOptional({ description: 'Whether SAR is required for critical flags' })
  @IsOptional()
  @IsBoolean()
  requireSarForCritical?: boolean;
}
