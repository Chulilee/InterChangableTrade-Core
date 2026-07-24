import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum ReportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ReportFormat {
  JSON = 'json',
  CSV = 'csv',
  PDF = 'pdf',
}

export enum ReportType {
  TRADE_SUMMARY = 'trade_summary',
  USER_ANALYTICS = 'user_analytics',
  REVENUE_REPORT = 'revenue_report',
  SYSTEM_HEALTH = 'system_health',
  BLOCKCHAIN_METRICS = 'blockchain_metrics',
  CUSTOM = 'custom',
}

@Entity('saved_reports')
export class SavedReport extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  reportType: ReportType;

  @Column({ type: 'varchar', length: 20 })
  format: ReportFormat;

  @Column({ type: 'varchar', length: 20 })
  status: ReportStatus;

  @Column({ type: 'timestamptz' })
  dateFrom: Date;

  @Column({ type: 'timestamptz' })
  dateTo: Date;

  @Column({ type: 'jsonb', nullable: true })
  filters?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metrics?: string[];

  @Column({ type: 'jsonb', nullable: true })
  dimensions?: string[];

  @Column({ type: 'text', nullable: true })
  fileUrl?: string;

  @Column({ type: 'bigint', nullable: true })
  fileSize?: number;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'boolean', default: false })
  isScheduled: boolean;

  @Column({ type: 'varchar', nullable: true })
  scheduleCron?: string;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;
}