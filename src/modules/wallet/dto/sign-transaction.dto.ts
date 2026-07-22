import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SignTransactionDto {
  @ApiProperty({
    description: 'Base64-encoded unsigned XDR transaction envelope',
  })
  @IsString()
  @IsNotEmpty()
  unsignedXdr: string;
}
