import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  IsEnum,
  ValidateIf,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ConditionType {
  PRICE_GT = 'price_gt',
  PRICE_LT = 'price_lt',
  PRICE_GTE = 'price_gte',
  PRICE_LTE = 'price_lte',
  AMOUNT_GT = 'amount_gt',
  AMOUNT_LT = 'amount_lt',
}

export class ConditionalLegDto {
  @ApiPropertyOptional({ description: 'Type of condition to evaluate' })
  @IsOptional()
  @IsEnum(ConditionType)
  conditionType?: ConditionType;

  @ApiPropertyOptional({
    description:
      'Condition expression (e.g., "1.05" for price_gt, meaning execute only if price > 1.05)',
  })
  @IsOptional()
  @IsString()
  conditionExpression?: string;
}

export class SwapLegDto {
  @ApiProperty({ description: 'Soroban contract ID to invoke' })
  @IsString()
  contractId: string;

  @ApiProperty({ description: 'Contract method to invoke' })
  @IsString()
  method: string;

  @ApiPropertyOptional({
    description: 'Arguments for the contract invocation',
  })
  @IsOptional()
  @IsObject()
  args?: Record<string, any>;

  @ApiProperty({ description: 'Source asset code for the swap' })
  @IsString()
  sourceAssetCode: string;

  @ApiPropertyOptional({ description: 'Source asset issuer (null for native)' })
  @IsOptional()
  @IsString()
  sourceAssetIssuer?: string;

  @ApiProperty({ description: 'Destination asset code for the swap' })
  @IsString()
  destAssetCode: string;

  @ApiPropertyOptional({
    description: 'Destination asset issuer (null for native)',
  })
  @IsOptional()
  @IsString()
  destAssetIssuer?: string;

  @ApiProperty({ description: 'Amount to swap' })
  @IsNumber()
  @Min(0.0000001)
  amount: number;

  @ApiProperty({
    description: 'Minimum acceptable output amount (slippage protection)',
  })
  @IsNumber()
  @Min(0)
  minAmountOut: number;

  @ApiPropertyOptional({
    description: 'Maximum acceptable output amount (price bounds)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmountOut?: number;

  @ApiPropertyOptional({
    description:
      'IDs of legs that must complete before this one (by order index)',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  dependencies?: number[];

  @ApiPropertyOptional({ description: 'Whether this leg has a conditional' })
  @IsOptional()
  @IsBoolean()
  isConditional?: boolean;

  @ApiPropertyOptional({
    description: 'Conditional execution details',
    type: ConditionalLegDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionalLegDto)
  @ValidateIf((obj) => obj.isConditional === true)
  conditional?: ConditionalLegDto;
}

export class CreateBatchDto {
  @ApiProperty({ description: 'Human-readable name for this batch' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Swap legs to execute atomically',
    type: [SwapLegDto],
    minItems: 1,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SwapLegDto)
  legs: SwapLegDto[];

  @ApiPropertyOptional({
    description: 'Maximum time allowed for the entire batch (ms)',
    default: 30000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of retry attempts for transient failures',
    default: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsNumber()
  maxRetries?: number;

  @ApiPropertyOptional({ description: 'Optional metadata for the batch' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
