import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { WebhookDeliveryStatus } from '../enums/webhook-delivery-status.enum';

/**
 * Records each attempt to deliver a webhook payload.
 * Used for delivery tracking, retry management, and audit trail.
 */
@Entity('webhook_deliveries')
export class WebhookDelivery extends BaseEntity {
  /** Reference to the webhook subscription */
  @Index()
  @Column({ type: 'uuid' })
  webhookSubscriptionId: string;

  /** The event type that triggered this delivery */
  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  /** The event payload sent to the endpoint */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** HMAC-SHA256 signature of the payload */
  @Column({ type: 'varchar', length: 128 })
  signature: string;

  /** Current delivery status */
  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  /** HTTP status code returned by the endpoint */
  @Column({ type: 'int', nullable: true })
  httpStatusCode?: number | null;

  /** Response body from the endpoint (truncated to 1KB) */
  @Column({ type: 'text', nullable: true })
  responseBody?: string | null;

  /** Error message if delivery failed */
  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  /** Current retry attempt number (0 = first attempt) */
  @Column({ type: 'int', default: 0 })
  attemptNumber: number;

  /** Maximum number of retries allowed */
  @Column({ type: 'int', default: 5 })
  maxRetries: number;

  /** Total time taken for this delivery in milliseconds */
  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  /** Timestamp when the delivery was created */
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  deliveredAt: Date;

  /** Timestamp when the next retry should be attempted */
  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt?: Date | null;

  /** Additional metadata (e.g., endpoint IP, user agent) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
