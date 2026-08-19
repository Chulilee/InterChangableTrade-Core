import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { SignatoryRole } from '../enums/signatory-role.enum';
import { EscrowAccount } from './escrow-account.entity';

@Entity('escrow_signatories')
@Index(['escrowAccountId', 'userId'], { unique: true })
export class EscrowSignatory extends BaseEntity {
  @ManyToOne(() => EscrowAccount, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'escrowAccountId' })
  escrowAccount: EscrowAccount;

  @Index()
  @Column({ type: 'uuid' })
  escrowAccountId: string;

  /** Platform user who is a signatory */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** Stellar public key of this signatory (used for on-chain verification) */
  @Column({ type: 'varchar', length: 56 })
  publicKey: string;

  /** Role of this signatory in the escrow */
  @Column({ type: 'enum', enum: SignatoryRole, default: SignatoryRole.COUNTERPARTY })
  role: SignatoryRole;

  /** Whether this signatory has approved the escrow */
  @Column({ type: 'boolean', default: false })
  hasApproved: boolean;

  /** Timestamp when approval was given */
  @Column({ type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  /** Timestamp when approval was revoked (if allowed) */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  /** IP address of the approver for audit trail */
  @Column({ type: 'varchar', length: 45, nullable: true })
  approvalIpAddress?: string | null;
}
