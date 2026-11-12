import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ResolveDisputeDto {
  @ApiProperty({
    description:
      'If true, release remaining funds to the escrow creator; if false, resolve in favor of the counterparty according to service logic.',
    example: true,
  })
  @IsBoolean()
  releaseToCreator: boolean;
}
