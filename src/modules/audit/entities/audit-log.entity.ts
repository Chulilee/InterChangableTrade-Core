import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Broad classification of an audited event, used for filtering and for scoping
 * compliance reports.
 */
export enum AuditCategory {
  USER_ACTION = 'user_action',
  ADMIN_ACTION = 'admin_action',
  SYSTEM_EVENT = 'system_event',
  DATA_CHANGE = 'data_change',
  SECURITY = 'security',
}

/**
 * Whether the audited action ultimately succeeded. Failures are retained too —
 * a rejected login or a forbidden admin call is exactly what a security
 * investigation needs.
 */
export enum AuditOutcome {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

/**
 * An immutable, append-only record of a single system activity.
 *
 * Immutability is a property of how this table is written, not just a
 * convention: the {@link AuditLog} intentionally has **no** `@UpdateDateColumn`
 * and the service layer never issues `UPDATE`/`DELETE` against it — rows are
 * only ever inserted. In a deployed environment the guarantee is hardened at
 * the database level by revoking `UPDATE`/`DELETE` on this table from the
 * application role (see `docs/audit-logging.md`).
 */
@Entity('audit_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
@Index(['resourceType', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * When the event occurred. This is the only timestamp on the row — there is
   * deliberately no `updatedAt`, because an audit record is never updated.
   */
  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Index()
  @Column({
    type: 'enum',
    enum: AuditCategory,
    default: AuditCategory.SYSTEM_EVENT,
  })
  category: AuditCategory;

  /**
   * The action performed, e.g. `user.login`, `trade.execute`, `settings.update`,
   * `admin.user.suspend`. A dotted `resource.verb` convention keeps actions
   * greppable and groupable.
   */
  @Index()
  @Column({ type: 'varchar', length: 128 })
  action: string;

  @Column({ type: 'enum', enum: AuditOutcome, default: AuditOutcome.SUCCESS })
  outcome: AuditOutcome;

  /** The authenticated actor, when the event was performed by a user. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  /** The actor's role at the time of the action, captured for admin reporting. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  userRole?: string | null;

  /** The kind of resource acted upon, e.g. `trade`, `wallet`, `user`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  resourceType?: string | null;

  /** The id of the specific resource acted upon, when applicable. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  resourceId?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  httpMethod?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  path?: string | null;

  @Column({ type: 'int', nullable: true })
  statusCode?: number | null;

  /** Wall-clock time the handler took, used to alert on audit overhead. */
  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  userAgent?: string | null;

  /** Correlation id linking the audit row to request/application logs. */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId?: string | null;

  /**
   * Snapshot of the resource before the change, for `DATA_CHANGE` events.
   * Stored as JSON so reports can diff it against {@link afterState}.
   */
  @Column({ type: 'jsonb', nullable: true })
  beforeState?: Record<string, unknown> | null;

  /** Snapshot of the resource after the change, for `DATA_CHANGE` events. */
  @Column({ type: 'jsonb', nullable: true })
  afterState?: Record<string, unknown> | null;

  /** Free-form structured context (never secrets — payloads are redacted). */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
