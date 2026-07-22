import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

export enum WalletStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  LOCKED = 'locked',
}

/**
 * Represents a Stellar wallet account linked to a platform user.
 * The encrypted secret key is stored separately from the public key
 * and is never exposed through the API.
 */
@Entity('wallets')
export class Wallet extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 56 })
  publicKey: string;

  /** AES-256-GCM encrypted Stellar secret key. Never returned by the API. */
  @Column({ type: 'text', select: false })
  encryptedSecretKey: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label?: string;

  @Column({ type: 'enum', enum: WalletStatus, default: WalletStatus.ACTIVE })
  status: WalletStatus;

  /** Whether this wallet is the user's default/primary wallet. */
  @Column({ type: 'boolean', default: false })
  isPrimary: boolean;

  /** Cached XLM balance, updated asynchronously. */
  @Column({ type: 'decimal', precision: 20, scale: 7, default: '0' })
  cachedBalance: string;

  /** Timestamp of the last successful balance sync. */
  @Column({ type: 'timestamptz', nullable: true })
  balanceSyncedAt?: Date;

  /** For multi-sig: minimum number of signers required. */
  @Column({ type: 'int', nullable: true })
  multisigThreshold?: number;

  /** For multi-sig: JSON array of co-signer public keys. */
  @Column({ type: 'jsonb', nullable: true })
  cosigners?: string[];
}
