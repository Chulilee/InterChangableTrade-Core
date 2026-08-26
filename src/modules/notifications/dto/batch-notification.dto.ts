import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

export class BatchNotificationItemDto {
  @IsString()
  @IsNotEmpty()
  recipient: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class BatchNotificationDto {
  @IsEnum(Channel)
  channel: Channel;

  @IsEnum(NotificationType)
  @IsOptional()
  type?: NotificationType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchNotificationItemDto)
  notifications: BatchNotificationItemDto[];
}
