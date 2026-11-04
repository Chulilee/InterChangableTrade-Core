import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Hard cap on the unsigned envelope size. XDR parsing is synchronous, so an
 * oversized blob is a cheap CPU/memory denial-of-service vector. A legitimate
 * classic transaction is a few kilobytes at most.
 */
export const MAX_UNSIGNED_XDR_LENGTH = 4096;

export class SignTransactionDto {
  @ApiProperty({
    description: 'Base64-encoded unsigned XDR transaction envelope',
    maxLength: MAX_UNSIGNED_XDR_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_UNSIGNED_XDR_LENGTH)
  unsignedXdr: string;
}
