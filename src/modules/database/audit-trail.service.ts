import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';

export enum AuditAction {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
  ACCESSED = 'accessed',
}

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId?: string;
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);
  private readonly auditedTables = new Set([
    'users',
    'wallets',
    'listings',
    'orders',
    'trades',
    'assets',
  ]);

  constructor(private readonly dataSource: DataSource) {}

  async log(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    if (!this.auditedTables.has(entry.entityType)) {
      return;
    }

    const queryRunner = manager?.queryRunner ?? this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      if (!queryRunner.isTransactionActive) {
        await queryRunner.startTransaction();
      }

      await queryRunner.manager.insert('audit_trails', {
        entityId: entry.entityId,
        entityType: entry.entityType,
        action: entry.action,
        actorId: entry.actorId ?? 'system',
        previousState: entry.previousState ?? {},
        newState: entry.newState ?? {},
        metadata: entry.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (!manager?.queryRunner?.isTransactionActive) {
        await queryRunner.commitTransaction();
      }
      } catch (error) {
        this.logger.error('Failed to write audit trail', error);
        if (!manager?.queryRunner?.isTransactionActive && queryRunner.isTransactionActive) {
          await queryRunner.rollbackTransaction();
        }
        throw error;
      } finally {
        if (!manager?.queryRunner) {
          await queryRunner.release();
        }
      }
  }

  async findAuditTrail(
    entityType: string,
    entityId: string,
    limit = 50,
    manager?: EntityManager,
  ): Promise<any[]> {
    const qb = (manager ?? this.dataSource.manager)
      .createQueryBuilder()
      .select('*')
      .from('audit_trails', 'audit')
      .where('audit.entityType = :entityType', { entityType })
      .andWhere('audit.entityId = :entityId', { entityId })
      .orderBy('audit.createdAt', 'DESC')
      .limit(limit);

    return qb.getRawMany();
  }

  async getEntityHistory(
    entityId: string,
    limit = 100,
  ): Promise<any[]> {
    return this.dataSource.manager.query(
      `SELECT * FROM audit_trails WHERE entityId = $1 ORDER BY "createdAt" DESC LIMIT $2`,
      [entityId, limit],
    );
  }

  isAudited(table: string): boolean {
    return this.auditedTables.has(table);
  }

  registerAuditedTable(table: string): void {
    this.auditedTables.add(table);
  }
}
