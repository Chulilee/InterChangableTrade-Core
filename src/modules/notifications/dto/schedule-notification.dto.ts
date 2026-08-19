import { IsDateString, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

export class ScheduleNotificationDto {
  @IsEnum(Channel)
  channel: Channel;

  @IsString()
  @IsNotEmpty()
  recipient: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

  @IsString()
  @IsOptional()
  title?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsDateString()
  scheduledAt: string;
}
