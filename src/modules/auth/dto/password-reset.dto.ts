import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'trader@example.com' })
  @IsEmail()
  email: string;
}

export class ConfirmPasswordResetDto {
  @ApiProperty({ description: 'Token received via email' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8, example: 'NewS3curePass!' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
