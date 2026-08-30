import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsUUID, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { BatchStatus } from '../entities/transaction-batch.entity';

export class QueryBatchDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by batch status' })
  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search by batch name' })
  @IsOptional()
  @IsString()
  name?: string;
}
