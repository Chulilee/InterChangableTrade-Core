import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  TransactionStatus,
  TransactionType,
} from '../entities/transaction.entity';

/**
 * Payload for recording a transaction. Used by internal flows (e.g. a completed
 * purchase) and by the indexer when it ingests on-chain activity.
 */
export class RecordTransactionDto {
  @ApiPropertyOptional({ description: 'Canonical Stellar transaction hash' })
  @IsOptional()
  @IsString()
  stellarTxHash?: string;

  @ApiPropertyOptional({ description: 'Owning user id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromAccount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toAccount?: string;

  @ApiProperty({ example: 'XLM' })
  @IsString()
  assetCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetIssuer?: string;

  @ApiProperty({ example: '100.0000000' })
  @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ description: 'Related marketplace listing id' })
  @IsOptional()
  @IsUUID()
  listingId?: string;
}
