import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { DeliveryStatus } from '../enums/delivery-status.enum';

export class SearchNotificationsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
