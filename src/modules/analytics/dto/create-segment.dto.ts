import { IsNotEmpty, IsOptional, IsString, IsArray, IsEnum, IsUUID } from 'class-validator';
import { SegmentType } from '../entities/user-segment.entity';

export class CreateSegmentDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(SegmentType)
  segmentType: SegmentType;

  @IsOptional()
  filterCriteria?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];
}