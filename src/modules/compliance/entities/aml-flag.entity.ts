import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';
import { AmlFlagStatus } from '../enums/aml-flag-status.enum';

/**
 * A flagged suspicious activity or transaction requiring compliance review.
 * Created automatically by the risk engine or manually by compliance officers.
 */
@Entity('aml_flags')
export class AmlFlag extends BaseEntity {
  /** The user associated with this flag */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /** The transaction that triggered this flag (if transaction-based) */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId?: string | null;

  /** Risk level assigned to this flag */
  @Column({ type: 'enum', enum: AmlRiskLevel, default: AmlRiskLevel.MEDIUM })
  riskLevel: AmlRiskLevel;

  /** Current review status */
  @Column({
    type: 'enum',
    enum: AmlFlagStatus,
    default: AmlFlagStatus.PENDING,
  })
  status: AmlFlagStatus;

  /** The pattern or rule that triggered this flag */
  @Index()
  @Column({ type: 'varchar', length: 128 })
  triggerRule: string;

  /** Human-readable description of why this was flagged */
  @Column({ type: 'text' })
  description: string;

  /** Numeric risk score at time of flagging (0-100) */
  @Column({ type: 'int', default: 0 })
  riskScore: number;

  /** Transaction amount that triggered the flag (if applicable) */
  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  transactionAmount?: string | null;

  /** Compliance officer reviewing this flag */
  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  /** Timestamp when the review started */
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  /** Resolution notes from the reviewer */
  @Column({ type: 'text', nullable: true })
  resolutionNotes?: string | null;

  /** Additional evidence or context (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  evidence?: Record<string, unknown> | null;

  /** Whether a SAR (Suspicious Activity Report) was filed */
  @Column({ type: 'boolean', default: false })
  sarFiled: boolean;

  /** SAR reference number if filed */
  @Column({ type: 'varchar', length: 128, nullable: true })
  sarReference?: string | null;
}
