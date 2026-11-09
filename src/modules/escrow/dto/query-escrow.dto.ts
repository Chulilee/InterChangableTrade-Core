import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { EscrowStatus } from '../enums/escrow-status.enum';
import { EscrowType } from '../enums/escrow-type.enum';

/**
 * Query parameters for listing escrow accounts.
 *
 * Extends the shared {@link PaginationQueryDto} so `page`/`limit` are coerced
 * from their string query values and bounded consistently with other list
 * endpoints (issue #94).
 */
export class QueryEscrowDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EscrowStatus })
  @IsOptional()
  @IsEnum(EscrowStatus)
  status?: EscrowStatus;

  @ApiPropertyOptional({ enum: EscrowType })
  @IsOptional()
  @IsEnum(EscrowType)
  type?: EscrowType;

  @ApiPropertyOptional({ description: 'Filter by creator' })
  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @ApiPropertyOptional({ description: 'Filter by associated trade' })
  @IsOptional()
  @IsUUID()
  tradeId?: string;
}
