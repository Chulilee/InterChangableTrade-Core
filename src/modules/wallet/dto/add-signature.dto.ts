import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsStellarPublicKey } from '../validators/is-stellar-public-key.validator';

/**
 * Adds one signature to a pooled transaction. Two mutually exclusive modes:
 *
 * 1. **Server-custodied** — provide `walletId`; the server decrypts that
 *    wallet's key and signs on the caller's behalf.
 * 2. **External** — provide `signerPublicKey` + `signatureXdr` (a base64
 *    `DecoratedSignature` produced by an offline/hardware signer). This is what
 *    lets signers participate without the server ever holding their key.
 *
 * The cross-field rule (exactly one mode) is enforced in the service.
 */
export class AddSignatureDto {
  @ApiPropertyOptional({
    description:
      'Server-custodied wallet id to sign with (mode 1). Mutually exclusive with signerPublicKey/signatureXdr.',
  })
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @ApiPropertyOptional({
    description: 'Public key of an external signer (mode 2, G...)',
  })
  @IsOptional()
  @IsStellarPublicKey()
  signerPublicKey?: string;

  @ApiPropertyOptional({
    description:
      'Base64 XDR DecoratedSignature from an external signer (mode 2)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  signatureXdr?: string;
}
