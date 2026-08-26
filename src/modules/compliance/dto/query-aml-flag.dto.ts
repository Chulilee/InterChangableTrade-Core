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
import { AmlFlagStatus } from '../enums/aml-flag-status.enum';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';
import { PaginationQueryDto } from '@app/common';

/**
 * Query parameters for listing AML flags with filtering.
 */
export class QueryAmlFlagDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AmlFlagStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(AmlFlagStatus)
  status?: AmlFlagStatus;

  @ApiPropertyOptional({
    enum: AmlRiskLevel,
    description: 'Filter by risk level',
  })
  @IsOptional()
  @IsEnum(AmlRiskLevel)
  riskLevel?: AmlRiskLevel;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by trigger rule' })
  @IsOptional()
  @IsString()
  triggerRule?: string;
}
