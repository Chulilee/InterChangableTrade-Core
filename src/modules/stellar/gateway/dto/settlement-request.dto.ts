import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SettlementRequestDto {
  @ApiProperty({
    description: 'Source Stellar account ID that will send the funds',
    example: 'GDE...XYZ',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  fromAccount: string;

  @ApiProperty({
    description: 'Destination Stellar account ID that will receive the funds',
    example: 'GABC...123',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  toAccount: string;

  @ApiProperty({
    description: 'Asset code for the asset being transferred',
    example: 'USDC',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiProperty({
    description: 'Issuer address of the asset (null for native XLM)',
    example: 'GA...ISSUER',
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  assetIssuer?: string | null;

  @ApiProperty({
    description: 'Amount of the asset to transfer',
    example: '100.50',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  amount: string;
}