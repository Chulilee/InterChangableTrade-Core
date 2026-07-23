import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

/** Step 1 — request a sign challenge for a given Stellar public key. */
export class StellarChallengeRequestDto {
  @ApiProperty({
    description: 'Stellar account public key (G…)',
    example: 'GABC1234EFGH5678...',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'publicKey must be a valid Stellar public key',
  })
  publicKey: string;
}

/** Step 2 — submit a signed challenge to receive a JWT. */
export class StellarVerifyDto {
  @ApiProperty({ description: 'Nonce returned by the challenge endpoint' })
  @IsString()
  @IsNotEmpty()
  nonce: string;

  @ApiProperty({ description: 'Stellar account public key (G…)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'publicKey must be a valid Stellar public key',
  })
  publicKey: string;

  @ApiProperty({ description: 'Base64-encoded Ed25519 signature of the nonce' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
