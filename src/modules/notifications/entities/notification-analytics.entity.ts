import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

@Entity('notification_analytics')
@Index(['ruleId', 'triggeredAt'])
@Index(['severity', 'category'])
@Index(['userId', 'triggeredAt'])
export class NotificationAnalytics extends BaseEntity {
  @Column({ type: 'varchar', nullable: true })
  ruleId?: string;

  @Column({ type: 'varchar', nullable: true })
  ruleName?: string;

  @Column({ type: 'varchar', nullable: true })
  severity?: string;

  @Column({ type: 'varchar', nullable: true })
  category?: string;

  @Column({ type: 'varchar', nullable: true })
  userId?: string;

  @Column({ type: 'varchar', nullable: true })
  notificationId?: string;

  @Column({ type: 'timestamptz', nullable: true })
  triggeredAt?: Date;

  @Column({ type: 'int', nullable: true })
  processingLatency?: number;

  @Column({ type: 'varchar', nullable: true })
  userAction?: 'opened' | 'clicked' | 'dismissed';

  @Column({ type: 'timestamptz', nullable: true })
  actionTimestamp?: Date;

  @Column({ type: 'varchar', nullable: true })
  type?: string;

  // For aggregated metrics
  @Column({ type: 'bigint', nullable: true })
  totalEventsProcessed?: number;

  @Column({ type: 'bigint', nullable: true })
  totalAlertsTriggered?: number;

  @Column({ type: 'bigint', nullable: true })
  totalAlertsThrottled?: number;

  @Column({ type: 'bigint', nullable: true })
  totalDeduplicated?: number;

  @Column({ type: 'bigint', nullable: true })
  totalProcessingErrors?: number;

  @Column({ type: 'float', nullable: true })
  averageProcessingTime?: number;
}
