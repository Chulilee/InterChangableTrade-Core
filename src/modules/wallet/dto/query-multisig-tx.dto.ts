import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { MultisigTransactionStatus } from '../enums/multisig-transaction-status.enum';

/** Query params for listing a wallet's pooled multi-sig transactions. */
export class QueryMultisigTxDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MultisigTransactionStatus,
    description: 'Filter by transaction status',
  })
  @IsOptional()
  @IsEnum(MultisigTransactionStatus)
  status?: MultisigTransactionStatus;
}
