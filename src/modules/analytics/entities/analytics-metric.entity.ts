import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum MetricType {
  TRADE_VOLUME = 'trade_volume',
  TRADE_COUNT = 'trade_count',
  USER_ACTIVE = 'user_active',
  USER_NEW = 'user_new',
  SYSTEM_LATENCY = 'system_latency',
  REVENUE = 'revenue',
  TRANSACTION_FEE = 'transaction_fee',
  BLOCKCHAIN_GAS = 'blockchain_gas',
  SETTLEMENT_TIME = 'settlement_time',
  ERROR_RATE = 'error_rate',
}

export enum MetricAggregation {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

@Entity('analytics_metrics')
@Index(['metricType', 'aggregation', 'timestamp'], { unique: true })
export class AnalyticsMetric extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  metricType: MetricType;

  @Column({ type: 'varchar', length: 20 })
  aggregation: MetricAggregation;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  value: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, string>;

  @Column({ type: 'varchar', nullable: true })
  assetCode?: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string;

  @Column({ type: 'varchar', nullable: true })
  userId?: string;

  @Column({ type: 'varchar', nullable: true })
  source?: string;
}