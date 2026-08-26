import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { AuditTrail, AuditTrailAction } from './entities/audit-trail.entity';
import { AuditContextService } from './audit-context';

/**
 * Global TypeORM subscriber performing row-level change capture.
 *
 * For every entity except {@link AuditTrail} itself (to avoid recursion) it
 * writes an `audit_trails` row with:
 * - `actorId`: the authenticated user bound by `ActorContextInterceptor`
 *   (falls back to `system`),
 * - `action`: insert / update / delete,
 * - `before`: the row as loaded from the database (updates and deletes),
 * - `after`: the persisted row (inserts and updates).
 *
 * Trail failures are logged and swallowed: auditing must never break the
 * business operation it observes.
 */
@EventSubscriber()
export class AuditTrailSubscriber implements EntitySubscriberInterface {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Receives all entities; {@link shouldCapture} filters out the trail table.
   */
  listenTo() {
    return Object;
  }

  async afterInsert(event: InsertEvent<unknown>): Promise<void> {
    await this.capture(
      event.manager,
      event.metadata.targetName,
      this.extractId(event.entity),
      AuditTrailAction.INSERT,
      null,
      event.entity as Record<string, unknown>,
    );
  }

  async afterUpdate(event: UpdateEvent<unknown>): Promise<void> {
    await this.capture(
      event.manager,
      event.metadata.targetName,
      this.extractId(event.entity ?? event.databaseEntity),
      AuditTrailAction.UPDATE,
      (event.databaseEntity ?? null) as Record<string, unknown> | null,
      (event.entity ?? null) as Record<string, unknown> | null,
    );
  }

  async afterRemove(event: RemoveEvent<unknown>): Promise<void> {
    await this.capture(
      event.manager,
      event.metadata.targetName,
      this.extractId(event.entity ?? event.databaseEntity),
      AuditTrailAction.DELETE,
      (event.databaseEntity ?? null) as Record<string, unknown> | null,
      null,
    );
  }

  /** Never audit the audit trail — it would recurse forever. */
  private shouldCapture(targetName?: string): boolean {
    return targetName !== 'AuditTrail' && !!targetName;
  }

  private extractId(entity: unknown): string {
    const id = (entity as { id?: unknown })?.id;
    return id === undefined || id === null ? 'unknown' : String(id);
  }

  private async capture(
    manager: Pick<DataSource, 'getRepository'>,
    entityType: string | undefined,
    entityId: string,
    action: AuditTrailAction,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.shouldCapture(entityType)) return;

    try {
      const trail = manager.getRepository(AuditTrail).create({
        actorId: AuditContextService.getActor().id,
        action,
        entityType,
        entityId,
        before: this.snapshot(before),
        after: this.snapshot(after),
      });
      await manager
        .getRepository(AuditTrail)
        // jsonb snapshots don't fit TypeORM's strict insert partial type.
        .insert(trail as never);
    } catch (error) {
      // Auditing is observability, not business logic — never rethrow.
      console.error(`audit-trail: failed to record ${action} on ${entityType}`, error);
    }
  }

  /** Strips non-serializable noise (functions, class methods) from rows. */
  private snapshot(row: Record<string, unknown> | null) {
    return row ? (JSON.parse(JSON.stringify(row)) as Record<string, unknown>) : null;
  }
}
