import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class AppealDisputeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  appealReason: string;
}
