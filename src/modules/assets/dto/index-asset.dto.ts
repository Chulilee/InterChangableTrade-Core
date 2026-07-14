import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Payload used to register/upsert an asset in the index. Normally populated by
 * the indexing job, but also exposed for manual seeding and admin correction.
 */
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
  domain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
