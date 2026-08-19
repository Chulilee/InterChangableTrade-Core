import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

export class UpdateNotificationPreferenceDto {
  @IsEnum(Channel)
  channel: Channel;

  @IsBoolean()
  isEnabled: boolean;

  @IsArray()
  @IsEnum(NotificationType, { each: true })
  @IsOptional()
  subscribedTypes?: NotificationType[];
}
