import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { Channel } from '../enums/channel.enum';

export class SearchNotificationsDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
