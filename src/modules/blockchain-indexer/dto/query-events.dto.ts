import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BlockchainEventType } from '../enums/blockchain-event-type.enum';

export class QueryEventsDto {
  @ApiPropertyOptional({ enum: BlockchainEventType })
  @IsOptional()
  @IsEnum(BlockchainEventType)
  eventType?: BlockchainEventType;

  @ApiPropertyOptional()
  @IsOptional()
  transactionHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  sourceAccount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  destinationAccount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  assetCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  assetIssuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  amountFrom?: number;

  @ApiPropertyOptional()
  @IsOptional()
  amountTo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ledgerFrom?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ledgerTo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
