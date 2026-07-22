import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateTrustlineDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID()
  user: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsUUID()
  asset: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  limit: string;
}
