import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { DisputeClassification } from '../enums/dispute-classification.enum';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeResolutionType } from '../enums/dispute-resolution-type.enum';

@Entity('disputes')
export class Dispute extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  tradeId: string;

  @Index()
  @Column({ type: 'uuid' })
  complainantId: string;

  @Index()
  @Column({ type: 'uuid' })
  respondentId: string;

  @Column({
    type: 'enum',
    enum: DisputeClassification,
  })
  classification: DisputeClassification;

  @Index()
  @Column({
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.FILED,
  })
  status: DisputeStatus;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'uuid', nullable: true })
  arbitratorId?: string | null;

  @Column({
    type: 'enum',
    enum: DisputeResolutionType,
    nullable: true,
  })
  resolutionType?: DisputeResolutionType | null;

  @Column({ type: 'text', nullable: true })
  decisionReasoning?: string | null;

  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  resolutionAmount?: string | null;

  @Column({ type: 'boolean', default: false })
  appealed: boolean;

  @Column({ type: 'boolean', default: false })
  similarDisputesFlagged: boolean;

  @Column({ type: 'boolean', default: false })
  enforcementExecuted: boolean;

  @Column({ type: 'timestamptz' })
  initialReviewDeadline: Date;

  @Column({ type: 'timestamptz' })
  resolutionDeadline: Date;

  @Column({ type: 'timestamptz', nullable: true })
  initialReviewCompletedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
