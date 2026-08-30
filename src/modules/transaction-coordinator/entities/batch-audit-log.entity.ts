import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum BatchAuditAction {
  BATCH_CREATED = 'batch_created',
  BATCH_PREPARE_STARTED = 'batch_prepare_started',
  BATCH_PREPARED = 'batch_prepared',
  BATCH_COMMIT_STARTED = 'batch_commit_started',
  BATCH_COMMITTED = 'batch_committed',
  BATCH_ROLLBACK_STARTED = 'batch_rollback_started',
  BATCH_ROLLED_BACK = 'batch_rolled_back',
  BATCH_FAILED = 'batch_failed',
  BATCH_EXPIRED = 'batch_expired',
  LEG_PREPARED = 'leg_prepared',
  LEG_EXECUTED = 'leg_executed',
  LEG_ROLLED_BACK = 'leg_rolled_back',
  LEG_FAILED = 'leg_failed',
  LEG_RETRIED = 'leg_retried',
  CONDITION_EVALUATED = 'condition_evaluated',
  CONSISTENCY_CHECK_PASSED = 'consistency_check_passed',
  CONSISTENCY_CHECK_FAILED = 'consistency_check_failed',
  PARTIAL_FILL_RECOVERY = 'partial_fill_recovery',
}

/**
 * Complete audit trail for the transaction coordinator.
 *
 * Every state transition in the batch lifecycle is recorded here for
 * dispute resolution and debugging.
 */
@Entity('batch_audit_logs')
@Index('IDX_audit_batch_id', ['batchId'])
@Index('IDX_audit_action', ['action'])
@Index('IDX_audit_created_at', ['createdAt'])
export class BatchAuditLog extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  batchId: string;

  /** Leg ID if this audit entry is leg-specific (null for batch-level) */
  @Column({ type: 'uuid', nullable: true })
  legId?: string | null;

  @Column({
    type: 'enum',
    enum: BatchAuditAction,
  })
  action: BatchAuditAction;

  /** The actor who triggered this action (userId or 'system') */
  @Column({ type: 'varchar' })
  actorId: string;

  /** State before the action */
  @Column({ type: 'jsonb', nullable: true })
  previousState?: Record<string, any> | null;

  /** State after the action */
  @Column({ type: 'jsonb', nullable: true })
  newState?: Record<string, any> | null;

  /** Additional context (errors, gas estimates, timing, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  /** Duration of the operation in milliseconds */
  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;
}
