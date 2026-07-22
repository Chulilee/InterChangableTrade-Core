import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ValidateTradeDto {
  @ApiProperty()
  @IsUUID()
  fromAsset: string;

  @ApiProperty()
  @IsUUID()
  toAsset: string;
}
