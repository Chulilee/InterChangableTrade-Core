import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { WebhookEvent } from '../enums/webhook-event.enum';

/**
 * Request body for creating a new webhook subscription.
 */
export class CreateWebhookDto {
  @ApiProperty({ description: 'Human-readable name for the webhook' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'URL to receive webhook payloads',
    format: 'uri',
  })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({
    description: 'Event types to subscribe to',
    enum: WebhookEvent,
    isArray: true,
    example: [WebhookEvent.TRADE_COMPLETED, WebhookEvent.SETTLEMENT_COMPLETED],
  })
  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  events: WebhookEvent[];

  @ApiPropertyOptional({ description: 'Description of the webhook purpose' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Custom HTTP headers to include in delivery requests',
    example: { 'X-Custom-Header': 'value' },
  })
  @IsOptional()
  customHeaders?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Authorization token sent via Authorization header',
  })
  @IsOptional()
  @IsString()
  authToken?: string;

  @ApiPropertyOptional({
    description: 'Maximum retry attempts (default: 5)',
    minimum: 0,
    maximum: 10,
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @ApiPropertyOptional({
    description: 'Rate limit: max deliveries per minute (default: 60)',
    minimum: 1,
    maximum: 300,
    default: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  rateLimitPerMinute?: number;
}
