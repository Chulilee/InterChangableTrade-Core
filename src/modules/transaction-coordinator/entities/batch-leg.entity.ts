import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum LegStatus {
  PENDING = 'pending',
  PREPARING = 'preparing',
  PREPARED = 'prepared',
  EXECUTING = 'executing',
  EXECUTED = 'executed',
  ROLLING_BACK = 'rolling_back',
  ROLLED_BACK = 'rolled_back',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Represents a single leg (swap) within a transaction batch.
 *
 * Each leg has a dependency graph — legs with no dependencies can execute
 * in parallel, while dependent legs wait for their predecessors.
 */
@Entity('batch_legs')
@Index('IDX_legs_batch_id', ['batchId'])
@Index('IDX_legs_status', ['status'])
export class BatchLeg extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  batchId: string;

  /** Sequence order within the batch (0-based) */
  @Column({ type: 'int' })
  orderIndex: number;

  /** IDs of legs that must complete before this one can start */
  @Column({ type: 'jsonb', default: '[]' })
  dependencies: string[];

  /** Soroban contract ID to invoke for this leg */
  @Column({ type: 'varchar' })
  contractId: string;

  /** Contract method to invoke */
  @Column({ type: 'varchar' })
  method: string;

  /** Arguments for the contract invocation */
  @Column({ type: 'jsonb', default: '{}' })
  args: Record<string, any>;

  /** Source asset code for the swap */
  @Column({ type: 'varchar' })
  sourceAssetCode: string;

  /** Source asset issuer (null for native) */
  @Column({ type: 'varchar', nullable: true })
  sourceAssetIssuer?: string | null;

  /** Destination asset code for the swap */
  @Column({ type: 'varchar' })
  destAssetCode: string;

  /** Destination asset issuer (null for native) */
  @Column({ type: 'varchar', nullable: true })
  destAssetIssuer?: string | null;

  /** Amount to swap */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  amount: string;

  /** Minimum acceptable output amount (slippage protection) */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  minAmountOut: string;

  /** Maximum acceptable output amount (optional, for price bounds) */
  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  maxAmountOut?: string | null;

  /** Current status of this leg */
  @Column({
    type: 'enum',
    enum: LegStatus,
    default: LegStatus.PENDING,
  })
  status: LegStatus;

  /** Whether this leg has a conditional execution requirement */
  @Column({ type: 'boolean', default: false })
  isConditional: boolean;

  /** Condition expression for conditional execution (e.g., "price > 1.5") */
  @Column({ type: 'varchar', nullable: true })
  conditionExpression?: string | null;

  /** Condition type for conditional execution */
  @Column({ type: 'varchar', nullable: true })
  conditionType?: string | null;

  /** Expected output amount (estimated before execution) */
  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  expectedOutput?: string | null;

  /** Actual output amount after execution */
  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  actualOutput?: string | null;

  /** Stellar transaction hash for this leg */
  @Column({ type: 'varchar', nullable: true })
  stellarTxHash?: string | null;

  /** Error message if this leg failed */
  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  /** Execution metadata (gas used, execution time, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  executionMetadata?: Record<string, any> | null;

  /** Timestamp when this leg was prepared */
  @Column({ type: 'timestamptz', nullable: true })
  preparedAt?: Date | null;

  /** Timestamp when this leg was executed */
  @Column({ type: 'timestamptz', nullable: true })
  executedAt?: Date | null;

  /** Timestamp when this leg was rolled back */
  @Column({ type: 'timestamptz', nullable: true })
  rolledBackAt?: Date | null;

  /** Retry count for transient failures */
  @Column({ type: 'int', default: 0 })
  retryCount: number;
}
