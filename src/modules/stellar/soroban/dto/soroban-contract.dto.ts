import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** Register a contract's ABI from base64-encoded XDR spec entries. */
export class RegisterAbiDto {
  @ApiProperty({ description: 'Soroban contract id (starts with C)' })
  @IsString()
  @Matches(CONTRACT_ID, {
    message: 'contractId must be a valid Soroban contract id',
  })
  contractId: string;

  @ApiProperty({
    description: 'Base64-encoded XDR spec entries for the contract',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  specEntriesXdr: string[];
}

/** Invoke a contract method (read or write, decided by the route). */
export class InvokeSorobanContractDto {
  @ApiProperty({ description: 'Soroban contract id (starts with C)' })
  @IsString()
  @Matches(CONTRACT_ID, {
    message: 'contractId must be a valid Soroban contract id',
  })
  contractId: string;

  @ApiProperty({ description: 'Contract method name to invoke' })
  @IsString()
  method: string;

  @ApiPropertyOptional({
    description:
      'Named arguments keyed by the parameter names in the contract spec',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}

/** Read a contract storage entry. */
export class GetContractStateDto {
  @ApiProperty({ description: 'Soroban contract id (starts with C)' })
  @IsString()
  @Matches(CONTRACT_ID, {
    message: 'contractId must be a valid Soroban contract id',
  })
  contractId: string;

  @ApiProperty({
    description: 'Native storage key (string, number, or structured value)',
  })
  key: unknown;

  @ApiPropertyOptional({
    description: 'Ledger durability of the entry',
    enum: ['persistent', 'temporary'],
    default: 'persistent',
  })
  @IsOptional()
  @IsIn(['persistent', 'temporary'])
  durability?: 'persistent' | 'temporary';

  @ApiPropertyOptional({
    description: 'Bypass the cache and re-fetch from chain',
  })
  @IsOptional()
  forceRefresh?: boolean;
}

/** Start indexing a contract's events. */
export class WatchEventsDto {
  @ApiProperty({ description: 'Soroban contract id (starts with C)' })
  @IsString()
  @Matches(CONTRACT_ID, {
    message: 'contractId must be a valid Soroban contract id',
  })
  contractId: string;

  @ApiPropertyOptional({
    description: 'Ledger to begin indexing from (defaults to current ledger)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  fromLedger?: number;
}
