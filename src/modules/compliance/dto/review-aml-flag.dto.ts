import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';
import { AmlFlagStatus } from '../enums/aml-flag-status.enum';

/**
 * Request body for admin review of an AML flag.
 */
export class ReviewAmlFlagDto {
  @ApiProperty({ enum: AmlFlagStatus, description: 'Resolution status' })
  @IsEnum(AmlFlagStatus)
  status: AmlFlagStatus;

  @ApiProperty({ description: 'Resolution notes from the reviewer' })
  @IsString()
  resolutionNotes: string;

  @ApiPropertyOptional({ description: 'Whether a SAR was filed' })
  @IsOptional()
  sarFiled?: boolean;

  @ApiPropertyOptional({ description: 'SAR reference number if filed' })
  @IsOptional()
  @IsString()
  sarReference?: string;

  @ApiPropertyOptional({ description: 'Additional evidence (JSON string)' })
  @IsOptional()
  @IsString()
  evidence?: string;
}
