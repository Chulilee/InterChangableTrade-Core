import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { WalletStatus } from '../entities/wallet.entity';

export class UpdateWalletDto {
  @ApiPropertyOptional({ description: 'Human-readable label for the wallet', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ enum: WalletStatus, description: 'Wallet status' })
  @IsOptional()
  @IsEnum(WalletStatus)
  status?: WalletStatus;

  @ApiPropertyOptional({ description: 'Set as the primary wallet for this user' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}