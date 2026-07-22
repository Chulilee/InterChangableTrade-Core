import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { AssetStatus } from '../entities/asset.entity';

export class IndexAssetDto {
  @ApiProperty({ example: 'USDC' })
  @IsString()
  @Length(1, 12)
  code: string;

  @ApiPropertyOptional({
    description: 'Issuer public key; omit for the native XLM asset.',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'issuer must be a valid Stellar public key',
  })
  issuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: AssetStatus })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTradeable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deprecationDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  migratedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
