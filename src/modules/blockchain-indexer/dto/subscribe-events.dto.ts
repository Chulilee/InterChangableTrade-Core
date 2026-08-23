import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BlockchainEventType } from '../enums/blockchain-event-type.enum';

/**
 * DTO for subscribing to real-time events via REST.
 * The WebSocket gateway accepts a similar shape directly.
 */
export class SubscribeEventsDto {
  @ApiPropertyOptional({
    description: 'Filter by event types. Empty = all types.',
    enum: BlockchainEventType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(BlockchainEventType, { each: true })
  eventTypes?: BlockchainEventType[];

  @ApiPropertyOptional({
    description: 'Filter by Soroban contract IDs.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contractIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by source or destination accounts.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accounts?: string[];

  @ApiPropertyOptional({ description: 'Minimum ledger sequence to include.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromLedger?: number;
}

/**
 * DTO for querying state at a specific block (temporal query).
 */
export class TemporalQueryDto {
  @ApiPropertyOptional({
    description: 'Query events as they were at this ledger sequence.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  atLedger: number;

  @ApiPropertyOptional({ description: 'Filter by event types.' })
  @IsOptional()
  @IsEnum(BlockchainEventType)
  eventType?: BlockchainEventType;

  @ApiPropertyOptional({ description: 'Filter by contract ID.' })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiPropertyOptional({ description: 'Filter by account.' })
  @IsOptional()
  @IsString()
  account?: string;

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
