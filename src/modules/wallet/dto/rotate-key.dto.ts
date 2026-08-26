import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_SIGNER_WEIGHT } from '../constants/multisig.constants';
import { IsStellarPublicKey } from '../validators/is-stellar-public-key.validator';

/**
 * Request to rotate one signer key for another in a single `SetOptions`
 * transaction — the new signer is added and the old one removed (weight 0)
 * atomically. The account ID never changes, so this is key rotation without
 * migration.
 */
export class RotateKeyDto {
  @ApiProperty({
    description: 'Public key of the signer to remove (G...)',
  })
  @IsStellarPublicKey()
  oldSignerPublicKey: string;

  @ApiProperty({
    description: 'Public key of the replacement signer (G...)',
  })
  @IsStellarPublicKey()
  newSignerPublicKey: string;

  @ApiPropertyOptional({
    description:
      'Weight for the new signer. Defaults to the outgoing signer’s current weight so authority is preserved.',
    minimum: 1,
    maximum: MAX_SIGNER_WEIGHT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SIGNER_WEIGHT)
  weight?: number;
}
