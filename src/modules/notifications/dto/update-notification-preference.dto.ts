import { IsBoolean, IsEnum } from 'class-validator';
import { Channel } from '../enums/channel.enum';

export class UpdateNotificationPreferenceDto {
  @IsEnum(Channel)
  channel: Channel;

  @IsBoolean()
  isEnabled: boolean;
}
