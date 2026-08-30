import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  IsArray,
  IsUUID,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PoolType, PoolStatus } from '../entities/liquidity-pool.entity';

// ─── Pool Registry DTOs ───────────────────────────────────────────────────────

export class RegisterPoolDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: PoolType })
  @IsEnum(PoolType)
  type: PoolType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assetCodeA: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetIssuerA?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  assetCodeB: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetIssuerB?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  onChainAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  feeRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  config?: Record<string, any>;
}

export class QueryPoolsDto {
  @ApiPropertyOptional({ enum: PoolType })
  @IsOptional()
  @IsEnum(PoolType)
  type?: PoolType;

  @ApiPropertyOptional({ enum: PoolStatus })
  @IsOptional()
  @IsEnum(PoolStatus)
  status?: PoolStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class RefreshPoolDto {
  @ApiPropertyOptional({ description: 'Specific pool ID to refresh. Omit to refresh all active pools.' })
  @IsOptional()
  @IsUUID()
  poolId?: string;
}

// ─── Price Oracle DTOs ────────────────────────────────────────────────────────

export class GetPriceDto {
  @ApiProperty({ description: 'Token to price (asset code)' })
  @IsString()
  @IsNotEmpty()
  tokenIn: string;

  @ApiPropertyOptional({ description: 'Token issuer for non-native assets' })
  @IsOptional()
  @IsString()
  tokenInIssuer?: string;

  @ApiProperty({ description: 'Denomination token (asset code)' })
  @IsString()
  @IsNotEmpty()
  tokenOut: string;

  @ApiPropertyOptional({ description: 'Token issuer for non-native assets' })
  @IsOptional()
  @IsString()
  tokenOutIssuer?: string;
}

export class GetBatchPricesDto {
  @ApiProperty({ type: [GetPriceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GetPriceDto)
  pairs: GetPriceDto[];
}

// ─── Route Finding DTOs ───────────────────────────────────────────────────────

export class FindRouteDto {
  @ApiProperty({ description: 'Token to swap from' })
  @IsString()
  @IsNotEmpty()
  tokenIn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tokenInIssuer?: string;

  @ApiProperty({ description: 'Token to receive' })
  @IsString()
  @IsNotEmpty()
  tokenOut: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tokenOutIssuer?: string;

  @ApiProperty({ description: 'Amount of tokenIn to swap' })
  @IsNumber()
  @Min(0)
  amountIn: number;

  @ApiPropertyOptional({ description: 'Maximum number of hops', default: 4 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(6)
  maxHops?: number = 4;

  @ApiPropertyOptional({ description: 'Maximum acceptable price impact (0-1)', default: 0.05 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  maxPriceImpact?: number = 0.05;
}

export class FindMultiRouteDto extends FindRouteDto {
  @ApiPropertyOptional({ description: 'Number of alternative routes to return', default: 3 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  topN?: number = 3;
}

export class SplitRouteDto extends FindRouteDto {
  @ApiPropertyOptional({ description: 'Number of splits across pools', default: 3 })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(10)
  numSplits?: number = 3;
}

// ─── Price Impact DTOs ────────────────────────────────────────────────────────

export class EstimatePriceImpactDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tokenIn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tokenInIssuer?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tokenOut: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tokenOutIssuer?: string;

  @ApiProperty({ description: 'Input amount to estimate impact for' })
  @IsNumber()
  @Min(0)
  amountIn: number;

  @ApiPropertyOptional({ description: 'Specific pool ID. If omitted, estimates across all matching pools.' })
  @IsOptional()
  @IsUUID()
  poolId?: string;
}

// ─── Arbitrage DTOs ───────────────────────────────────────────────────────────

export class QueryArbitrageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  asset?: string;

  @ApiPropertyOptional({ description: 'Minimum spread % to report', default: 0.1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSpreadPercent?: number = 0.1;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// ─── Simulation DTOs ──────────────────────────────────────────────────────────

export class SimulateRouteDto {
  @ApiProperty({ description: 'Route pool IDs to simulate (in order)' })
  @IsArray()
  poolPath: string[];

  @ApiProperty({ description: 'Input amount' })
  @IsNumber()
  @Min(0)
  amountIn: number;

  @ApiPropertyOptional({ description: 'Expected minimum output. Simulation fails if route delivers less.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minAmountOut?: number;
}

// ─── Monitoring DTOs ──────────────────────────────────────────────────────────

export class PoolAlertDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
