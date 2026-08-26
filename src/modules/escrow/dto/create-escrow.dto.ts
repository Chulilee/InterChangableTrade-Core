import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EscrowType } from '../enums/escrow-type.enum';
import { SignatoryRole } from '../enums/signatory-role.enum';
import {
  MAX_SIGNATORIES,
  MIN_REQUIRED_SIGNATURES,
} from '../constants/escrow.constants';

class SignatoryInput {
  @ApiProperty({ description: 'Platform user ID of the signatory' })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Stellar public key of the signatory' })
  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @ApiProperty({ enum: SignatoryRole, default: SignatoryRole.COUNTERPARTY })
  @IsEnum(SignatoryRole)
  role: SignatoryRole;
}

class MilestoneInput {
  @ApiProperty({ description: 'Milestone title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'Milestone description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Order index for sequencing' })
  @IsInt()
  @Min(0)
  orderIndex: number;

  @ApiProperty({ description: 'Amount to release on completion' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class CreateEscrowDto {
  @ApiProperty({ enum: EscrowType, default: EscrowType.STANDARD })
  @IsEnum(EscrowType)
  type: EscrowType;

  @ApiProperty({
    description: 'Minimum number of signatures required (m in m-of-n)',
    minimum: MIN_REQUIRED_SIGNATURES,
  })
  @IsInt()
  @Min(MIN_REQUIRED_SIGNATURES)
  @Max(MAX_SIGNATORIES)
  requiredSignatures: number;

  @ApiProperty({ description: 'Asset code held in escrow' })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiPropertyOptional({ description: 'Asset issuer (null for native XLM)' })
  @IsOptional()
  @IsString()
  assetIssuer?: string;

  @ApiProperty({ description: 'Total amount to escrow' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ description: 'Optional description or memo' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Associated trade ID' })
  @IsOptional()
  @IsUUID()
  tradeId?: string;

  @ApiPropertyOptional({
    description: 'Settlement deadline (ISO 8601)',
  })
  @IsOptional()
  @IsString()
  settlementDeadline?: string;

  @ApiPropertyOptional({
    description: 'Time-lock expiry (ISO 8601), only for TIME_LOCKED type',
  })
  @IsOptional()
  @IsString()
  timeLockExpiry?: string;

  @ApiProperty({
    type: [SignatoryInput],
    description:
      'List of signatories (must include at least requiredSignatures)',
    minItems: MIN_REQUIRED_SIGNATURES,
  })
  @IsArray()
  @ArrayMinSize(MIN_REQUIRED_SIGNATURES)
  @ArrayMaxSize(MAX_SIGNATORIES)
  @ValidateNested({ each: true })
  @Type(() => SignatoryInput)
  signatories: SignatoryInput[];

  @ApiPropertyOptional({
    type: [MilestoneInput],
    description:
      'Milestones for partial release (required for MILESTONE_BASED type)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneInput)
  milestones?: MilestoneInput[];

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;
}
