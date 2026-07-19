import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelOrderDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  orderId: string;
}