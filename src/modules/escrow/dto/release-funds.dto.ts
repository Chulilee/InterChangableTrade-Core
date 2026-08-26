import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ReleaseFundsDto {
  @ApiPropertyOptional({
    description:
      'Amount to release (defaults to remaining balance for full settlement)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0000001)
  amount?: number;

  @ApiPropertyOptional({
    description: 'Destination public key (defaults to creator for refunds)',
  })
  @IsOptional()
  @IsString()
  destinationPublicKey?: string;

  @ApiPropertyOptional({ description: 'Milestone ID for partial release' })
  @IsOptional()
  @IsUUID()
  milestoneId?: string;

  @ApiPropertyOptional({ description: 'Reason or memo for the release' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
