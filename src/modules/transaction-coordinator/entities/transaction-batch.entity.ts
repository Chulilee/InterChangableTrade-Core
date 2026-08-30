import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum BatchStatus {
  CREATED = 'created',
  PREPARING = 'preparing',
  PREPARED = 'prepared',
  COMMITTING = 'committing',
  COMMITTED = 'committed',
  ROLLING_BACK = 'rolling_back',
  ROLLED_BACK = 'rolled_back',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

/**
 * Represents a coordinated multi-leg atomic swap batch.
 *
 * A batch groups multiple swap legs (e.g. USD → EUR → JPY) that must
 * all succeed or all fail atomically. The two-phase commit protocol
 * ensures no partial fills or stranded assets.
 */
@Entity('transaction_batches')
@Index('IDX_batches_user_status', ['userId', 'status'])
@Index('IDX_batches_created_at', ['createdAt'])
export class TransactionBatch extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({
    type: 'enum',
    enum: BatchStatus,
    default: BatchStatus.CREATED,
  })
  status: BatchStatus;

  /** Total number of legs in this batch */
  @Column({ type: 'int' })
  totalLegs: number;

  /** Number of legs that have been prepared successfully */
  @Column({ type: 'int', default: 0 })
  preparedLegs: number;

  /** Number of legs that have been committed successfully */
  @Column({ type: 'int', default: 0 })
  committedLegs: number;

  /** Overall atomic completion rate (0-100), updated after completion */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  completionRate?: string | null;

  /** Timestamp-based sequence number for MEV-resistant ordering */
  @Column({ type: 'bigint' })
  sequenceNumber: number;

  /** Maximum time allowed for the entire batch (ms) */
  @Column({ type: 'int', default: 30000 })
  timeoutMs: number;

  /** Whether all legs in the batch are conditional */
  @Column({ type: 'boolean', default: false })
  hasConditionals: boolean;

  /** Aggregate result summary after completion */
  @Column({ type: 'jsonb', nullable: true })
  resultSummary?: Record<string, any> | null;

  /** Error information if the batch failed */
  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  /** Metadata for the batch (e.g., strategy, slippage tolerance) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'timestamptz', nullable: true })
  preparedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  committedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  failedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;
}
