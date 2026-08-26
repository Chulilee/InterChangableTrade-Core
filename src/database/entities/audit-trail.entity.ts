import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The mutation that produced this trail record. Constrained at the database
 * level by a CHECK constraint (see the example migration) so only these
 * values can ever be persisted.
 */
export enum AuditTrailAction {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
}

/**
 * Append-only row-level change capture for entities of interest.
 *
 * Unlike `modules/audit` (which records request/activity events), the audit
 * *trail* is written automatically by {@link AuditTrailSubscriber} whenever a
 * subscribed entity is inserted/updated/deleted, capturing who did it
 * (`actorId`) and JSON snapshots of the row before and after the change.
 *
 * Immutability: rows are never updated or deleted from application code; in a
 * deployed environment `UPDATE`/`DELETE` grants are revoked from the app role.
 */
@Entity('audit_trails')
@Index(['entityType', 'entityId', 'createdAt'])
@Index(['actorId', 'createdAt'])
// Example constraint: only known mutation kinds may be persisted.
@Check(
  'CHK_audit_trails_action',
  '"action" IN (\'insert\', \'update\', \'delete\')',
)
export class AuditTrail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Authenticated actor responsible for the change ('system' when none). */
  @Column({ type: 'varchar', length: 64, default: 'system' })
  actorId: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: AuditTrailAction.INSERT,
  })
  action: AuditTrailAction | string;

  /** Entity target name, e.g. `Wallet`, `User`. */
  @Column({ type: 'varchar', length: 64 })
  entityType: string;

  /** Primary key of the affected row (kept as text to support any PK type). */
  @Column({ type: 'varchar', length: 128 })
  entityId: string;

  /** Row snapshot before the change (null for inserts). */
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  /** Row snapshot after the change (null for deletes). */
  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  /** Wall-clock time the change was captured. */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
