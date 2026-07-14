import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import {
  TransactionStatus,
  TransactionType,
} from '../entities/transaction.entity';

/**
 * Filters for browsing transaction history. All fields are optional and
 * combine with AND semantics.
 */
export class QueryTransactionDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ description: 'Filter by owning user id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by asset code' })
  @IsOptional()
  @IsString()
  assetCode?: string;
}
