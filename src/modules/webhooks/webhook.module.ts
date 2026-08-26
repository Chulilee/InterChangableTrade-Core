import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookController } from './webhook.controller';
import { WebhookSigningService } from './services/webhook-signing.service';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { WebhookSubscriptionService } from './services/webhook-subscription.service';
import { WebhookEventListener } from './webhook-event.listener';

/**
 * Webhook module for external integrations.
 *
 * Provides event-driven webhook delivery with:
 * - HMAC-SHA256 payload signing and verification
 * - Exponential backoff retry logic
 * - Delivery tracking and audit trail
 * - Rate limiting per endpoint
 * - Test delivery functionality
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookDelivery]),
    EventEmitterModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookSigningService,
    WebhookDeliveryService,
    WebhookSubscriptionService,
    WebhookEventListener,
  ],
  exports: [
    WebhookDeliveryService,
    WebhookSubscriptionService,
    WebhookSigningService,
  ],
})
export class WebhookModule {}
