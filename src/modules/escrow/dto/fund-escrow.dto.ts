import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FundEscrowDto {
  @ApiProperty({
    description: 'Stellar transaction hash proving escrow funding',
    example: 'a1b2c3d4e5f6...',
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  txHash: string;
}
