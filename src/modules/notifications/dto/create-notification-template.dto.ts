import { IsNotEmpty, IsString } from 'class-validator';

export class CreateNotificationTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  template: string;
}
