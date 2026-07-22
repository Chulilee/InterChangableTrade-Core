import { IsEnum, IsNotEmpty, IsObject, IsString } from 'class-validator';
import { Channel } from '../enums/channel.enum';

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
}
