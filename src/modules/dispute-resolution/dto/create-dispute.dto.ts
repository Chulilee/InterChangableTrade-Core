import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DisputeClassification } from '../enums/dispute-classification.enum';

export class CreateDisputeDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  tradeId: string;

  @ApiProperty({ enum: DisputeClassification })
  @IsEnum(DisputeClassification)
  classification: DisputeClassification;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}
