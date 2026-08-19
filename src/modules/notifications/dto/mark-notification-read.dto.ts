import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class MarkNotificationReadDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  notificationIds?: string[];

  @IsBoolean()
  @IsOptional()
  markAll?: boolean;
}
