import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitTransactionDto {
  @ApiProperty({
    description: 'Base64 encoded XDR of the signed transaction',
    example: 'AAAAAgAAAC...',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  transactionXdr: string;
}