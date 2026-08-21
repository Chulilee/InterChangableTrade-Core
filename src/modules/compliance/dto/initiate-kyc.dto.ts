import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { KycLevel } from '../enums/kyc-level.enum';
import { ComplianceRegion } from '../enums/compliance-region.enum';

/**
 * Request body for initiating a KYC verification workflow.
 */
export class InitiateKycDto {
  @ApiProperty({ description: 'Country/region code (ISO 3166-1 alpha-2)' })
  @IsString()
  region: string;

  @ApiPropertyOptional({ description: 'Target KYC verification level' })
  @IsOptional()
  @IsEnum(KycLevel)
  targetLevel?: KycLevel;

  @ApiPropertyOptional({ description: 'Additional context for the verification' })
  @IsOptional()
  @IsString()
  context?: string;
}
