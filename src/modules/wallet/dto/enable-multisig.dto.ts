import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_SIGNERS,
  MAX_SIGNER_WEIGHT,
  MAX_THRESHOLD,
} from '../constants/multisig.constants';
import { IsStellarPublicKey } from '../validators/is-stellar-public-key.validator';

/** A single signer entry to apply to the account via `SetOptions`. */
export class SignerEntryDto {
  @ApiProperty({ description: 'Stellar public key of the signer (G...)' })
  @IsStellarPublicKey()
  publicKey: string;

  @ApiProperty({
    description: 'Weight granted to this signer (0 removes it)',
    minimum: 0,
    maximum: MAX_SIGNER_WEIGHT,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_SIGNER_WEIGHT)
  weight: number;
}

/**
 * Request to build an unsigned `SetOptions` transaction that turns an account
 * into an M-of-N multisig account. The result is never auto-signed — it is
 * returned as XDR to flow through the signing pipeline.
 */
export class EnableMultisigDto {
  @ApiProperty({
    type: [SignerEntryDto],
    description:
      'Signers to add to the account (each weighted). Up to 20 — Stellar’s native signer limit.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SIGNERS)
  @ValidateNested({ each: true })
  @Type(() => SignerEntryDto)
  signers: SignerEntryDto[];

  @ApiPropertyOptional({
    description: 'New weight for the account master key (e.g. 0 to disable it)',
    minimum: 0,
    maximum: MAX_SIGNER_WEIGHT,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SIGNER_WEIGHT)
  masterWeight?: number;

  @ApiPropertyOptional({
    description: 'Weight required to authorise low-threshold operations',
    minimum: 0,
    maximum: MAX_THRESHOLD,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_THRESHOLD)
  lowThreshold?: number;

  @ApiPropertyOptional({
    description: 'Weight required to authorise medium-threshold operations',
    minimum: 0,
    maximum: MAX_THRESHOLD,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_THRESHOLD)
  medThreshold?: number;

  @ApiPropertyOptional({
    description:
      'Weight required to authorise high-threshold operations (SetOptions, AccountMerge)',
    minimum: 0,
    maximum: MAX_THRESHOLD,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_THRESHOLD)
  highThreshold?: number;
}
