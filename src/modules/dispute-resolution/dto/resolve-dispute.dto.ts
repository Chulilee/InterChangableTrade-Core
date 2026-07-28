import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DisputeResolutionType } from '../enums/dispute-resolution-type.enum';

export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolutionType })
  @IsEnum(DisputeResolutionType)
  resolutionType: DisputeResolutionType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(10000)
  decisionReasoning: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  resolutionAmount?: string;
}
