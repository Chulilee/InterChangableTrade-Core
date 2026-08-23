import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Unified event entity for the real-time ledger indexer. Stores both Stellar
 * native operations and Soroban contract events in a single table, enabling
 * cross-cutting temporal queries (state at ledger X) and efficient filtering.
 */
@Entity('indexed_events')
@Index(['sequenceNumber'], { unique: true })
@Index(['ledgerSequence'])
@Index(['eventType'])
@Index(['contractId'])
@Index(['sourceAccount'])
@Index(['timestamp'])
@Index(['ledgerSequence', 'eventType'])
@Index(['contractId', 'eventType'])
export class IndexedEvent extends BaseEntity {
  /** Monotonically increasing sequence number for ordering and deduplication. */
  @Column({ type: 'bigint' })
  sequenceNumber: string;

  /** Stellar ledger sequence where this event was produced. */
  @Column({ type: 'int' })
  ledgerSequence: number;

  /** Normalized event type (see BlockchainEventType enum). */
  @Column({ type: 'varchar' })
  eventType: string;

  /** Transaction hash that produced this event. */
  @Column({ type: 'varchar' })
  transactionHash: string;

  /** Block timestamp of the ledger. */
  @Column({ type: 'timestamptz' })
  timestamp: Date;

  /** Account or contract that initiated the event. */
  @Column({ type: 'varchar' })
  sourceAccount: string;

  /** Destination account, if applicable (payments, transfers). */
  @Column({ type: 'varchar', nullable: true })
  destinationAccount?: string;

  /** Soroban contract ID, if this is a contract event. */
  @Column({ type: 'varchar', nullable: true })
  contractId?: string;

  /** Soroban contract method name, if this is a contract invocation. */
  @Column({ type: 'varchar', nullable: true })
  methodName?: string;

  /** Asset code for native Stellar events. */
  @Column({ type: 'varchar', nullable: true })
  assetCode?: string;

  /** Asset issuer for non-native assets. */
  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string;

  /** Event amount, stored as string for precision. */
  @Column({ type: 'varchar', nullable: true })
  amount?: string;

  /** Event topics (Soroban contract events). */
  @Column({ type: 'jsonb', nullable: true })
  topics?: unknown[];

  /** Decoded event body (Soroban contract events). */
  @Column({ type: 'jsonb', nullable: true })
  value?: unknown;

  /** Normalized internal event data for quick access. */
  @Column({ type: 'jsonb', nullable: true })
  normalizedData?: Record<string, unknown>;

  /** Raw event data for debugging and replay. */
  @Column({ type: 'jsonb', nullable: true })
  raw?: Record<string, unknown>;

  /** Whether this event has been invalidated by a chain reorganization. */
  @Column({ type: 'boolean', default: false })
  invalidated: boolean;
}
