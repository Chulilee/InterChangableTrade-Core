import { Injectable, Logger } from '@nestjs/common';
import { randomBytes as cryptoRandomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookSubscription } from '../entities/webhook-subscription.entity';
import { WebhookDeliveryStatus } from '../enums/webhook-delivery-status.enum';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookEvent } from '../enums/webhook-event.enum';

/** Maximum payload size in bytes (256 KB) */
const MAX_PAYLOAD_SIZE = 256 * 1024;

/** Base delay for exponential backoff in milliseconds */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum retry delay in milliseconds (5 minutes) */
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    private readonly signingService: WebhookSigningService,
  ) {}

  /**
   * Process a webhook event and deliver to all matching subscriptions.
   * This is the main entry point triggered by platform events.
   */
  async processEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const startTime = Date.now();

    // Find all active subscriptions that listen for this event
    const subscriptions = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .where('sub.status = :status', { status: 'active' })
      .getMany();

    const matchingSubscriptions = subscriptions.filter(
      (sub: WebhookSubscription) =>
        sub.events.includes(eventType as WebhookEvent),
    );

    if (matchingSubscriptions.length === 0) {
      this.logger.debug(`No active subscriptions for event: ${eventType}`);
      return;
    }

    this.logger.log(
      `Processing event ${eventType} for ${matchingSubscriptions.length} subscription(s)`,
    );

    // Deliver to each matching subscription concurrently
    const deliveries = matchingSubscriptions.map((sub: WebhookSubscription) =>
      this.deliverEvent(sub, eventType, payload).catch((error: Error) => {
        this.logger.error(
          `Failed to queue delivery for subscription ${sub.id}: ${error.message}`,
        );
      }),
    );

    await Promise.allSettled(deliveries);

    const elapsed = Date.now() - startTime;
    if (elapsed > 50) {
      this.logger.warn(
        `Event ${eventType} processing took ${elapsed}ms (target: <50ms)`,
      );
    }
  }

  /**
   * Deliver an event to a specific webhook subscription.
   */
  async deliverEvent(
    subscription: WebhookSubscription,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDelivery> {
    const fullPayload = {
      id: this.generateEventId(),
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    // Truncate payload if too large
    const payloadJson = JSON.stringify(fullPayload);
    const truncatedPayload =
      payloadJson.length > MAX_PAYLOAD_SIZE
        ? JSON.parse(payloadJson.slice(0, MAX_PAYLOAD_SIZE) + '"}')
        : fullPayload;

    const signature = this.signingService.signPayload(
      truncatedPayload as Record<string, unknown>,
      subscription.secret,
    );

    const delivery = this.deliveryRepo.create({
      webhookSubscriptionId: subscription.id,
      eventType,
      payload: truncatedPayload as Record<string, unknown>,
      signature,
      status: WebhookDeliveryStatus.PENDING,
      attemptNumber: 0,
      maxRetries: subscription.maxRetries,
      deliveredAt: new Date(),
    });

    const saved = await this.deliveryRepo.save(delivery);

    // Fire and forget the actual HTTP delivery
    this.executeDelivery(saved, subscription).catch((error) => {
      this.logger.error(`Delivery execution failed: ${error.message}`);
    });

    return saved;
  }

  /**
   * Execute the HTTP delivery with retry logic and exponential backoff.
   */
  async executeDelivery(
    delivery: WebhookDelivery,
    subscription: WebhookSubscription,
  ): Promise<void> {
    const startTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'InterChangableTrade-Webhook/1.0',
      'X-Webhook-ID': subscription.id,
      'X-Webhook-Signature': `sha256=${delivery.signature}`,
      'X-Webhook-Timestamp': delivery.deliveredAt.toISOString(),
      'X-Webhook-Event': delivery.eventType,
      'X-Webhook-Delivery-Id': delivery.id,
    };

    // Add custom headers
    if (subscription.customHeaders) {
      Object.assign(headers, subscription.customHeaders);
    }

    // Add auth token
    if (subscription.authToken) {
      headers['Authorization'] = `Bearer ${subscription.authToken}`;
    }

    try {
      delivery.status = WebhookDeliveryStatus.RETRYING;
      await this.deliveryRepo.save(delivery);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(delivery.payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text();

      if (response.ok) {
        // Success
        delivery.status = WebhookDeliveryStatus.SUCCESS;
        delivery.httpStatusCode = response.status;
        delivery.responseBody = responseBody.slice(0, 1024);
        delivery.durationMs = durationMs;
        await this.deliveryRepo.save(delivery);

        // Update subscription stats
        await this.subscriptionRepo.update(subscription.id, {
          totalDeliveries: () => `"totalDeliveries" + 1`,
          lastDeliveredAt: new Date(),
          lastEventAt: new Date(),
        });

        this.logger.log(
          `Webhook delivered successfully: ${subscription.id} -> ${response.status} (${durationMs}ms)`,
        );
      } else {
        throw new Error(
          `HTTP ${response.status}: ${responseBody.slice(0, 200)}`,
        );
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      delivery.httpStatusCode = null;
      delivery.responseBody = null;
      delivery.errorMessage = errorMessage;
      delivery.durationMs = durationMs;

      // Check if we should retry
      if (delivery.attemptNumber < delivery.maxRetries) {
        delivery.attemptNumber += 1;
        delivery.status = WebhookDeliveryStatus.RETRYING;
        delivery.nextRetryAt = this.calculateRetryTime(delivery.attemptNumber);
        await this.deliveryRepo.save(delivery);

        // Schedule retry with exponential backoff
        const retryDelay = this.calculateRetryDelay(delivery.attemptNumber);
        this.logger.log(
          `Webhook delivery failed, retrying in ${retryDelay}ms (attempt ${delivery.attemptNumber}/${delivery.maxRetries})`,
        );

        setTimeout(() => {
          this.executeDelivery(delivery, subscription).catch((err) => {
            this.logger.error(`Retry execution failed: ${err.message}`);
          });
        }, retryDelay);
      } else {
        // Max retries exceeded
        delivery.status = WebhookDeliveryStatus.FAILED;
        delivery.attemptNumber = delivery.attemptNumber + 1;
        await this.deliveryRepo.save(delivery);

        // Update subscription failure stats
        await this.subscriptionRepo.update(subscription.id, {
          totalFailures: () => `"totalFailures" + 1`,
          lastFailedAt: new Date(),
        });

        this.logger.warn(
          `Webhook delivery failed after ${delivery.maxRetries} retries: ${subscription.id} - ${errorMessage}`,
        );
      }
    }
  }

  /**
   * Calculate exponential backoff delay.
   * delay = baseDelay * 2^attemptNumber, capped at MAX_RETRY_DELAY_MS
   */
  calculateRetryDelay(attemptNumber: number): number {
    return Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber - 1),
      MAX_RETRY_DELAY_MS,
    );
  }

  /**
   * Calculate the next retry time based on attempt number.
   */
  calculateRetryTime(attemptNumber: number): Date {
    const delay = this.calculateRetryDelay(attemptNumber);
    return new Date(Date.now() + delay);
  }

  /**
   * Get delivery history for a webhook subscription.
   */
  async getDeliveries(
    subscriptionId: string,
    options?: {
      status?: string;
      eventType?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: WebhookDelivery[]; total: number }> {
    const qb = this.deliveryRepo
      .createQueryBuilder('delivery')
      .where('delivery.webhookSubscriptionId = :id', { id: subscriptionId })
      .orderBy('delivery.createdAt', 'DESC');

    if (options?.status) {
      qb.andWhere('delivery.status = :status', { status: options.status });
    }
    if (options?.eventType) {
      qb.andWhere('delivery.eventType = :eventType', {
        eventType: options.eventType,
      });
    }
    if (options?.startDate) {
      qb.andWhere('delivery.deliveredAt >= :startDate', {
        startDate: options.startDate,
      });
    }
    if (options?.endDate) {
      qb.andWhere('delivery.deliveredAt <= :endDate', {
        endDate: options.endDate,
      });
    }

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  /**
   * Get a single delivery by ID.
   */
  async getDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
    });
    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }
    return delivery;
  }

  /**
   * Retry a specific failed delivery.
   */
  async retryDelivery(
    deliveryId: string,
    subscriptionId: string,
  ): Promise<WebhookDelivery> {
    const delivery = await this.getDelivery(deliveryId);
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: subscriptionId },
    });
    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    // Reset for retry
    delivery.status = WebhookDeliveryStatus.PENDING;
    delivery.attemptNumber = 0;
    delivery.errorMessage = null;
    delivery.nextRetryAt = null;
    const saved = await this.deliveryRepo.save(delivery);

    // Re-execute
    await this.executeDelivery(saved, subscription);

    return this.getDelivery(deliveryId);
  }

  /**
   * Test webhook delivery by sending a test payload.
   */
  async sendTestDelivery(
    subscription: WebhookSubscription,
  ): Promise<WebhookDelivery> {
    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery',
        webhook_id: subscription.id,
        webhook_name: subscription.name,
      },
    };

    return this.deliverEvent(subscription, 'webhook.test', testPayload.data);
  }

  /**
   * Generate a unique event ID.
   */
  private generateEventId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(8).toString('hex');
    return `evt_${timestamp}_${random}`;
  }
}

function randomBytes(size: number): Buffer {
  return cryptoRandomBytes(size);
}
