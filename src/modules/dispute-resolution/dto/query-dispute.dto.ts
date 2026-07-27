import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { DisputeClassification } from '../enums/dispute-classification.enum';
import { DisputeStatus } from '../enums/dispute-status.enum';

export class QueryDisputeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;

  @ApiPropertyOptional({ enum: DisputeClassification })
  @IsOptional()
  @IsEnum(DisputeClassification)
  classification?: DisputeClassification;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tradeId?: string;
}
