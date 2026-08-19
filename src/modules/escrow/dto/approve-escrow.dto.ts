import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveEscrowDto {
  @ApiPropertyOptional({
    description: 'Optional note with the approval',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
