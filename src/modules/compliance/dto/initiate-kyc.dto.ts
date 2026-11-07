import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { KycLevel } from '../enums/kyc-level.enum';

/**
 * Request body for initiating a KYC verification workflow.
 */
export class InitiateKycDto {
  @ApiProperty({ description: 'Country/region code (ISO 3166-1 alpha-2)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'region must be an ISO 3166-1 alpha-2 country code (e.g. US, DE, JP)',
  })
  region: string;

  @ApiPropertyOptional({ description: 'Target KYC verification level' })
  @IsOptional()
  @IsEnum(KycLevel)
  targetLevel?: KycLevel;

  @ApiPropertyOptional({
    description: 'Additional context for the verification',
  })
  @IsOptional()
  @IsString()
  context?: string;
}
