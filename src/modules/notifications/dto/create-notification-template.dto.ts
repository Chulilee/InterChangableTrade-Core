import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Channel } from '../enums/channel.enum';

export class CreateNotificationTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  bodyTemplate: string;

  @IsString()
  @IsOptional()
  htmlTemplate?: string;

  @IsEnum(Channel)
  @IsOptional()
  channel?: Channel;
}
