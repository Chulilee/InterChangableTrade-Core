import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '@app/common';
import { Wallet } from './wallet.entity';
import { MultisigSignature } from './multisig-signature.entity';
import { MultisigTransactionStatus } from '../enums/multisig-transaction-status.enum';
import { ThresholdCategory } from '../enums/threshold-category.enum';

/**
 * A pooled multi-signature transaction. The base envelope is stored immutably;
 * signatures are collected as separate {@link MultisigSignature} rows and
 * reassembled onto the envelope at broadcast. This is what lets signers sign
 * sequentially across independent requests without holding state in memory.
 */
@Entity('multisig_transactions')
@Index(['walletId', 'status'])
export class MultisigTransaction extends BaseEntity {
  @ManyToOne(() => Wallet, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  @Index()
  @Column({ type: 'uuid' })
  walletId: string;

  /** Stellar account the transaction operates on (the wallet's public key). */
  @Column({ type: 'varchar', length: 56 })
  sourceAccount: string;

  /** Immutable base transaction envelope (no signatures), base64 XDR. */
  @Column({ type: 'text' })
  unsignedXdr: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  /** Combined signature weight required to broadcast (the account threshold). */
  @Column({ type: 'int' })
  requiredWeight: number;

  /** Threshold category of the transaction's highest-category operation. */
  @Column({
    type: 'enum',
    enum: ThresholdCategory,
    default: ThresholdCategory.MEDIUM,
  })
  thresholdCategory: ThresholdCategory;

  @Index()
  @Column({
    type: 'enum',
    enum: MultisigTransactionStatus,
    default: MultisigTransactionStatus.PENDING_SIGNATURES,
  })
  status: MultisigTransactionStatus;

  /** User who proposed the transaction. */
  @Column({ type: 'uuid' })
  createdByUserId: string;

  /** Network passphrase the transaction hash is bound to. */
  @Column({ type: 'varchar', length: 100 })
  networkPassphrase: string;

  /** Canonical Stellar transaction hash, once broadcast. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  submittedTxHash?: string | null;

  /** Reason the network rejected the submission, if it failed. */
  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  /** Upper timebound of the transaction, after which it can no longer submit. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @OneToMany(() => MultisigSignature, (signature) => signature.transaction)
  signatures: MultisigSignature[];
}
