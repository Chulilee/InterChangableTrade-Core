import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum BatchStatus {
  /** Batch row created, transfers being finalized. */
  OPEN = 'open',
  /** Settlement is currently being executed on-chain. */
  EXECUTING = 'executing',
  /** All net transfers confirmed on-chain and member transactions settled. */
  SETTLED = 'settled',
  /** Execution failed before any member transaction was settled. */
  FAILED = 'failed',
  /** Partial execution happened and was rolled back atomically. */
  ROLLED_BACK = 'rolled_back',
}

export enum BatchTrigger {
  TIME = 'time',
  SIZE = 'size',
  MANUAL = 'manual',
}

/**
 * A single net transfer inside a settlement batch: the minimal payment that
 * replaces one or more individual transactions between the same accounts for
 * the same asset.
 */
export interface NetTransfer {
  fromAccount: string;
  toAccount: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
}

export interface FeeAnalysis {
  /** Number of transactions that would have been submitted individually. */
  individualTransactions: number;
  /** Number of transactions actually submitted by the batch. */
  batchedTransactions: number;
  /** Total fee (stroops) if every member was settled individually. */
  feeBeforeStroops: string;
  /** Total fee (stroops) paid by the batch settlement. */
  feeAfterStroops: string;
  /** Percentage reduction, e.g. "62.50". */
  savingsPercent: string;
}

/**
 * A settlement batch groups compatible pending transactions so they can be
 * settled with a small number of net on-chain payments instead of one
 * transaction per trade.
 */
@Entity('settlement_batches')
export class SettlementBatch extends BaseEntity {
  @Index()
  @Column({ type: 'enum', enum: BatchStatus, default: BatchStatus.OPEN })
  status: BatchStatus;

  @Column({ type: 'enum', enum: BatchTrigger })
  trigger: BatchTrigger;

  @Index({ unique: true, where: '"stellarTxHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  stellarTxHash?: string | null;

  @Column({ type: 'int' })
  transactionCount: number;

  /** IDs of the member transactions, kept for audit trail purposes. */
  @Column({ type: 'jsonb', default: [] })
  transactionIds: string[];

  /** Transactions excluded during composition validation, with reasons. */
  @Column({ type: 'jsonb', default: [] })
  rejected: Array<{ transactionId: string; reason: string }>;

  /** Minimal set of net payments executed for this batch. */
  @Column({ type: 'jsonb', default: [] })
  settlements: NetTransfer[];

  @Column({ type: 'jsonb', nullable: true })
  feeAnalysis?: FeeAnalysis | null;

  /** Wall-clock duration of the execute() call in milliseconds. */
  @Column({ type: 'int', nullable: true })
  processingMs?: number | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  windowOpenedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt?: Date | null;
}
