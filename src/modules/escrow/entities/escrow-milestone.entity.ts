import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { EscrowAccount } from './escrow-account.entity';

@Entity('escrow_milestones')
export class EscrowMilestone extends BaseEntity {
  @ManyToOne(() => EscrowAccount, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'escrowAccountId' })
  escrowAccount: EscrowAccount;

  @Index()
  @Column({ type: 'uuid' })
  escrowAccountId: string;

  /** Human-readable milestone title */
  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Optional description of the milestone */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Order index for sequencing milestones */
  @Column({ type: 'int' })
  orderIndex: number;

  /** Amount to release when this milestone is completed */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  amount: string;

  /** Whether this milestone has been completed */
  @Column({ type: 'boolean', default: false })
  isCompleted: boolean;

  /** Timestamp when milestone was marked complete */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  /** User who approved milestone completion */
  @Column({ type: 'uuid', nullable: true })
  completedBy?: string | null;

  /** Stellar tx hash for partial release associated with this milestone */
  @Column({ type: 'varchar', length: 100, nullable: true })
  releaseTxHash?: string | null;
}
