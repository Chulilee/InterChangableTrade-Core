import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_UNSIGNED_XDR_LENGTH } from './sign-transaction.dto';

/**
 * Proposes a transaction into the signing pool. The `unsignedXdr` is the
 * immutable base envelope; signers contribute decorated signatures against it
 * until the account threshold is met.
 */
export class ProposeMultisigTxDto {
  @ApiProperty({
    description: 'Base64-encoded unsigned XDR transaction envelope',
    maxLength: MAX_UNSIGNED_XDR_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_UNSIGNED_XDR_LENGTH)
  unsignedXdr: string;

  @ApiPropertyOptional({
    description: 'Human-readable description of what this transaction does',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
