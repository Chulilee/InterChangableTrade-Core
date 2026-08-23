import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { WebhookEvent } from '../enums/webhook-event.enum';
import { WebhookStatus } from '../enums/webhook-status.enum';

/**
 * A webhook subscription created by a user to receive event notifications.
 * Stores the endpoint URL, subscribed events, signing secret, and delivery configuration.
 */
@Entity('webhook_subscriptions')
export class WebhookSubscription extends BaseEntity {
  /** The user who owns this webhook */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** Human-readable name for this webhook */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** The URL to deliver webhook payloads to */
  @Column({ type: 'varchar', length: 2048 })
  url: string;

  /** Secret used to sign payloads via HMAC-SHA256 */
  @Column({ type: 'varchar', length: 256 })
  secret: string;

  /** Events this webhook subscribes to */
  @Column({ type: 'simple-array' })
  events: WebhookEvent[];

  /** Current status of the webhook */
  @Column({
    type: 'enum',
    enum: WebhookStatus,
    default: WebhookStatus.ACTIVE,
  })
  status: WebhookStatus;

  /** Optional description */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Custom HTTP headers sent with each delivery */
  @Column({ type: 'jsonb', nullable: true })
  customHeaders?: Record<string, string> | null;

  /** Bearer token or API key sent via Authorization header */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  authToken?: string | null;

  /** Maximum delivery attempts before disabling */
  @Column({ type: 'int', default: 5 })
  maxRetries: number;

  /** Rate limit: maximum deliveries per minute */
  @Column({ type: 'int', default: 60 })
  rateLimitPerMinute: number;

  /** Total number of successful deliveries */
  @Column({ type: 'int', default: 0 })
  totalDeliveries: number;

  /** Total number of failed deliveries */
  @Column({ type: 'int', default: 0 })
  totalFailures: number;

  /** Timestamp of the last successful delivery */
  @Column({ type: 'timestamptz', nullable: true })
  lastDeliveredAt?: Date | null;

  /** Timestamp of the last failed delivery */
  @Column({ type: 'timestamptz', nullable: true })
  lastFailedAt?: Date | null;

  /** Timestamp of the last event delivered */
  @Column({ type: 'timestamptz', nullable: true })
  lastEventAt?: Date | null;
}
