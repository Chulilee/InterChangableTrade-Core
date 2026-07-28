import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ArbitratorExpertise } from '../enums/arbitrator-expertise.enum';

export class CreateArbitratorDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: ArbitratorExpertise, isArray: true })
  @IsArray()
  @IsEnum(ArbitratorExpertise, { each: true })
  expertise: ArbitratorExpertise[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveDisputes?: number;
}
