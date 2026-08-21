import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Request body for manually updating a user's KYC level.
 */
export class UpdateKycLevelDto {
  @ApiPropertyOptional({ description: 'Compliance notes for the level change' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Whether to block transactions' })
  @IsOptional()
  @IsBoolean()
  transactionsBlocked?: boolean;

  @ApiPropertyOptional({ description: 'Reason for blocking/unblocking' })
  @IsOptional()
  @IsString()
  blockReason?: string;
}
