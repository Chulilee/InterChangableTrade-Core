import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Immutable audit trail for all compliance actions.
 * Follows the same append-only pattern as the general AuditLog.
 */
@Entity('compliance_audit_logs')
export class ComplianceAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** The user who performed the action (admin/compliance officer) */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  performedBy?: string | null;

  /** Role of the performer */
  @Column({ type: 'varchar', length: 32, nullable: true })
  performedByRole?: string | null;

  /** The user who is the subject of this compliance action */
  @Index()
  @Column({ type: 'uuid' })
  targetUserId: string;

  /** Category of the compliance action */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  action: string;

  /** Description of the action taken */
  @Column({ type: 'text' })
  description: string;

  /** Entity type affected (e.g., kyc_verification, kyc_document, aml_flag) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType?: string | null;

  /** ID of the affected entity */
  @Column({ type: 'varchar', length: 128, nullable: true })
  entityId?: string | null;

  /** Before state snapshot (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  previousState?: Record<string, unknown> | null;

  /** After state snapshot (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  newState?: Record<string, unknown> | null;

  /** IP address of the performer */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress?: string | null;

  /** Additional metadata (JSON) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
