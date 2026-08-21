import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@app/common';
import { ComplianceRegion } from '../enums/compliance-region.enum';
import { AmlRiskLevel } from '../enums/aml-risk-level.enum';

/**
 * Configurable compliance thresholds per region.
 * Allows different regulatory requirements across jurisdictions.
 */
@Entity('compliance_configs')
@Unique(['region'])
export class ComplianceConfig extends BaseEntity {
  /** Region this configuration applies to */
  @Index({ unique: true })
  @Column({ type: 'enum', enum: ComplianceRegion })
  region: ComplianceRegion;

  /** Display name for the region */
  @Column({ type: 'varchar', length: 128 })
  displayName: string;

  /** Transaction amount threshold for automatic AML flagging (in platform units) */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: '10000' })
  amlTransactionThreshold: string;

  /** Daily transaction volume threshold for flagging */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: '50000' })
  dailyVolumeThreshold: string;

  /** Risk score threshold above which transactions are blocked */
  @Column({ type: 'int', default: 80 })
  blockThresholdScore: number;

  /** Risk score threshold for enhanced due diligence */
  @Column({ type: 'int', default: 60 })
  enhancedDueDiligenceScore: number;

  /** Risk score threshold for flagging */
  @Column({ type: 'int', default: 40 })
  flagThresholdScore: number;

  /** Maximum number of transactions per day before flagging */
  @Column({ type: 'int', default: 50 })
  maxDailyTransactions: number;

  /** Number of months before KYC verification expires and must be renewed */
  @Column({ type: 'int', default: 12 })
  kycExpiryMonths: number;

  /** Required KYC level for institutional accounts */
  @Column({ type: 'varchar', length: 32, default: 'institutional' })
  institutionalRequiredLevel: string;

  /** Whether SAR filing is required for critical risk flags */
  @Column({ type: 'boolean', default: true })
  requireSarForCritical: boolean;

  /** Whether this configuration is active */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Additional region-specific rules (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  customRules?: Record<string, unknown> | null;
}
