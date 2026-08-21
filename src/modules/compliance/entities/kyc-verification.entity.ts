import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { KycLevel } from '../enums/kyc-level.enum';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';

/**
 * KYC verification record for a user.
 * Tracks the user's verification level, risk assessment, and compliance status.
 */
@Entity('kyc_verifications')
export class KycVerification extends BaseEntity {
  /** The user this verification belongs to */
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  /** Current KYC verification level */
  @Column({ type: 'enum', enum: KycLevel, default: KycLevel.UNVERIFIED })
  level: KycLevel;

  /** AML risk assessment level */
  @Column({ type: 'enum', enum: AmlRiskLevel, default: AmlRiskLevel.LOW })
  riskLevel: AmlRiskLevel;

  /** Composite risk score (0-100) computed from multiple factors */
  @Column({ type: 'int', default: 0 })
  riskScore: number;

  /** Country/region for regulatory compliance */
  @Column({ type: 'varchar', length: 2, nullable: true })
  region?: string | null;

  /** Whether the user's transactions are currently blocked */
  @Column({ type: 'boolean', default: false })
  transactionsBlocked: boolean;

  /** Reason for transaction block, if applicable */
  @Column({ type: 'text', nullable: true })
  blockReason?: string | null;

  /** Timestamp of last successful verification check */
  @Column({ type: 'timestamptz', nullable: true })
  lastVerifiedAt?: Date | null;

  /** Verification expiry date (some jurisdictions require periodic re-verification) */
  @Column({ type: 'timestamptz', nullable: true })
  verificationExpiry?: Date | null;

  /** Third-party verification service reference ID */
  @Column({ type: 'varchar', length: 256, nullable: true })
  thirdPartyRefId?: string | null;

  /** Notes from compliance officers */
  @Column({ type: 'text', nullable: true })
  complianceNotes?: string | null;

  /** Additional metadata (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
