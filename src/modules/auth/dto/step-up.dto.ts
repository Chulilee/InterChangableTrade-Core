import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Exchanges a valid refresh token for a short-lived step-up token. The refresh
 * token is used as proof of a recent, full authentication; the resulting token
 * only authorises high-risk wallet signing for a few minutes.
 */
export class StepUpDto {
  @ApiProperty({
    description: 'A valid, unrevoked refresh token for the current user',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
