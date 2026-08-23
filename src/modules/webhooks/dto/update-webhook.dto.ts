import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { WebhookEvent } from '../enums/webhook-event.enum';
import { WebhookStatus } from '../enums/webhook-status.enum';

/**
 * Request body for updating an existing webhook subscription.
 * All fields are optional; only provided fields will be updated.
 */
export class UpdateWebhookDto {
  @ApiPropertyOptional({ description: 'Updated webhook name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Updated endpoint URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiPropertyOptional({
    description: 'Updated event subscriptions',
    enum: WebhookEvent,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  events?: WebhookEvent[];

  @ApiPropertyOptional({ description: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated webhook status',
    enum: WebhookStatus,
  })
  @IsOptional()
  @IsEnum(WebhookStatus)
  status?: WebhookStatus;

  @ApiPropertyOptional({
    description: 'Updated custom HTTP headers',
  })
  @IsOptional()
  customHeaders?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Updated authorization token',
  })
  @IsOptional()
  @IsString()
  authToken?: string;

  @ApiPropertyOptional({
    description: 'Updated maximum retry attempts',
    minimum: 0,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @ApiPropertyOptional({
    description: 'Updated rate limit (deliveries per minute)',
    minimum: 1,
    maximum: 300,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  rateLimitPerMinute?: number;
}
