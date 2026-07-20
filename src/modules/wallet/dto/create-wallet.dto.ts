import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateWalletDto {
  @ApiPropertyOptional({ description: 'Human-readable label for the wallet', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ description: 'Set as the primary wallet for this user', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}