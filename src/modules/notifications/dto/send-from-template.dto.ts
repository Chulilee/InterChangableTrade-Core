import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

export class SendFromTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsEnum(Channel)
  channel: Channel;

  @IsString()
  @IsNotEmpty()
  recipient: string;

  @IsObject()
  data: Record<string, any>;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;
}
