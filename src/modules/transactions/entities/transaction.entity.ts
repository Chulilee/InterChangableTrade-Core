import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum TransactionType {
  PAYMENT = 'payment',
  TRADE = 'trade',
  LISTING_PURCHASE = 'listing_purchase',
  OTHER = 'other',
}

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * A record of value movement relevant to a user. `stellarTxHash` links the row
 * to the canonical on-chain transaction when one exists; it is unique so the
 * indexer can dedupe replays.
 */
@Entity('transactions')
export class Transaction extends BaseEntity {
  @Index({ unique: true, where: '"stellarTxHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  stellarTxHash?: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({
    type: 'enum',
    enum: TransactionType,
    default: TransactionType.OTHER,
  })
  type: TransactionType;

  @Index()
  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ nullable: true })
  fromAccount?: string;

  @Column({ nullable: true })
  toAccount?: string;

  @Column()
  assetCode: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string | null;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  amount: string;

  @Column({ type: 'uuid', nullable: true })
  listingId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  ledgerCloseTime?: Date | null;
}
