import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { EscrowStatus } from '../enums/escrow-status.enum';
import { EscrowType } from '../enums/escrow-type.enum';

export class QueryEscrowDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Computed skip for TypeORM */
  get skip(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 20);
  }

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
