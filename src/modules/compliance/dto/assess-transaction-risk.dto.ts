import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  Max,
  Min,
} from 'class-validator';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';

/**
 * Request body for assessing transaction risk.
 */
export class AssessTransactionRiskDto {
  @ApiProperty({ description: 'Transaction amount' })
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Transaction type (e.g., buy, sell, transfer)' })
  @IsString()
  transactionType: string;

  @ApiPropertyOptional({ description: 'Asset code being traded' })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({ description: 'Counterparty user ID' })
  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @ApiPropertyOptional({
    description: 'Recent transaction history (amounts and timestamps)',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  recentTransactions?: Array<{ amount: number; timestamp: string }>;
}

/**
 * Result of a transaction risk assessment.
 */
export class TransactionRiskResult {
  @ApiProperty({ description: 'Overall risk level' })
  riskLevel: AmlRiskLevel;

  @ApiProperty({ description: 'Risk score (0-100)' })
  riskScore: number;

  @ApiProperty({ description: 'Whether the transaction should be blocked' })
  shouldBlock: boolean;

  @ApiProperty({ description: 'Triggered rules' })
  triggeredRules: string[];

  @ApiProperty({ description: 'Risk factors considered' })
  factors: Record<string, unknown>;
}
