import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { EscrowStatus } from '../enums/escrow-status.enum';
import { EscrowType } from '../enums/escrow-type.enum';

@Entity('escrow_accounts')
export class EscrowAccount extends BaseEntity {
  /** User who initiated the escrow */
  @Index()
  @Column({ type: 'uuid' })
  creatorId: string;

  /** Stellar public key of the escrow account (m-of-n multisig) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 56, nullable: true })
  escrowAddress?: string | null;

  @Index()
  @Column({ type: 'enum', enum: EscrowType, default: EscrowType.STANDARD })
  type: EscrowType;

  @Index()
  @Column({ type: 'enum', enum: EscrowStatus, default: EscrowStatus.PENDING })
  status: EscrowStatus;

  /** m in m-of-n: minimum signatures required to release */
  @Column({ type: 'int' })
  requiredSignatures: number;

  /** n in m-of-n: total number of signatories */
  @Column({ type: 'int' })
  totalSignatories: number;

  /** Asset code being held in escrow */
  @Column({ type: 'varchar', length: 12 })
  assetCode: string;

  /** Asset issuer (null for native XLM) */
  @Column({ type: 'varchar', length: 56, nullable: true })
  assetIssuer?: string | null;

  /** Total amount deposited into escrow */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  amount: string;

  /** Amount already released from escrow */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: '0' })
  releasedAmount: string;

  /** Platform fee for escrow service */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: '0' })
  feeAmount: string;

  /** Deadline by which signatories must approve; after this, funds can be refunded */
  @Column({ type: 'timestamptz', nullable: true })
  settlementDeadline?: Date | null;

  /** For time-locked accounts: when the lock expires and auto-settlement triggers */
  @Column({ type: 'timestamptz', nullable: true })
  timeLockExpiry?: Date | null;

  /** Optional description or memo for the escrow */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Reference to an associated trade, if applicable */
  @Column({ type: 'uuid', nullable: true })
  tradeId?: string | null;

  /** Reference to a dispute, if one has been raised */
  @Column({ type: 'uuid', nullable: true })
  disputeId?: string | null;

  /** Stellar transaction hash for the funding transaction */
  @Column({ type: 'varchar', length: 100, nullable: true })
  fundingTxHash?: string | null;

  /** Stellar transaction hash for the settlement transaction */
  @Column({ type: 'varchar', length: 100, nullable: true })
  settlementTxHash?: string | null;

  /** Timestamp when the escrow was funded */
  @Column({ type: 'timestamptz', nullable: true })
  fundedAt?: Date | null;

  /** Timestamp when the escrow was settled */
  @Column({ type: 'timestamptz', nullable: true })
  settledAt?: Date | null;

  /** Timestamp when the escrow was refunded */
  @Column({ type: 'timestamptz', nullable: true })
  refundedAt?: Date | null;

  /** Additional metadata (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
