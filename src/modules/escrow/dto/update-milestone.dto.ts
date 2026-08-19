import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateMilestoneDto {
  @ApiProperty({ description: 'Whether the milestone is completed' })
  @IsBoolean()
  @IsNotEmpty()
  isCompleted: boolean;

  @ApiPropertyOptional({ description: 'Notes about milestone completion' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
