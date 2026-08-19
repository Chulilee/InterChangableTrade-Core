import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class FlagDisputeDto {
  @ApiProperty({ description: 'Reason for raising a dispute' })
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  reason: string;

  @ApiProperty({ description: 'Evidence or supporting details' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  evidence: string;
}
