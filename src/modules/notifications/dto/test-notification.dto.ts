import { IsString } from 'class-validator';

export class TestNotificationDto {
  @IsString()
  message: string;
}
