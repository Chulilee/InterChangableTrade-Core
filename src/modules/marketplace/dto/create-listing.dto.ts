import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateListingDto {
  @ApiProperty({ example: 'Selling 100 USDC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 'USDC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  assetCode: string;

  @ApiPropertyOptional({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    description: 'Asset issuer public key; omit for native XLM.',
  })
  @IsOptional()
  @IsString()
  assetIssuer?: string;

  @ApiProperty({ example: '100.0000000', description: 'Amount offered.' })
  @IsNumberString()
  amount: string;

  @ApiProperty({ example: '1.2500000', description: 'Unit price.' })
  @IsNumberString()
  price: string;

  @ApiPropertyOptional({ example: 'XLM', default: 'XLM' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  priceAssetCode?: string;
}
