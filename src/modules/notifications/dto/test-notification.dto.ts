import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '../enums/notification-type.enum';

export class TestNotificationDto {
  @IsString()
  message: string;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

  @IsString()
  @IsOptional()
  title?: string;
}
