import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class MultisigConfigDto {
  @ApiProperty({
    description:
      'Minimum number of signers required to authorise a transaction',
    minimum: 1,
    maximum: 10,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  threshold: number;

  @ApiProperty({
    type: [String],
    description: 'Stellar public keys of the co-signers',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  cosigners: string[];
}
