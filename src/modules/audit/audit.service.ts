import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import {
  AuditCategory,
  AuditLog,
  AuditOutcome,
} from './entities/audit-log.entity';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import {
  ComplianceReportType,
  GenerateReportDto,
  ReportFormat,
} from './dto/generate-report.dto';
import { ReportTable, toCsv, toPdf } from './reporting/report-writers';

/** Fields the caller supplies when appending an audit record. */
export type AuditRecord = Partial<
  Pick<
    AuditLog,
    | 'category'
    | 'action'
    | 'outcome'
    | 'userId'
    | 'userRole'
    | 'resourceType'
    | 'resourceId'
    | 'httpMethod'
    | 'path'
    | 'statusCode'
    | 'durationMs'
    | 'ipAddress'
    | 'userAgent'
    | 'requestId'
    | 'beforeState'
    | 'afterState'
    | 'metadata'
  >
> & { action: string };

/** A rendered compliance report ready to stream to the client. */
export interface RenderedReport {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Minimum retention for audit records. Regulatory requirements (e.g. SOX,
 * AML/KYC record-keeping) commonly mandate seven years; nothing is purged
 * before this window, and even then rows are archived to cold storage rather
 * than deleted.
 */
export const AUDIT_RETENTION_YEARS = 7;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Append a single immutable audit record. This is the only write path for the
   * table — there is deliberately no update or delete.
   */
  async append(record: AuditRecord): Promise<AuditLog> {
    const entity = this.auditRepository.create({
      category: record.category ?? AuditCategory.SYSTEM_EVENT,
      outcome: record.outcome ?? AuditOutcome.SUCCESS,
      ...record,
    });
    return this.auditRepository.save(entity);
  }

  /**
   * Fire-and-forget append used on the hot request path. Persisting is not
   * awaited by the caller so audit capture stays off the request's critical
   * path (keeping the added latency minimal); a failure is logged rather than
   * propagated so auditing can never break the request it is observing.
   */
  record(record: AuditRecord): void {
    this.append(record).catch((err) => {
      this.logger.error(
        `Failed to persist audit record for action "${record.action}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /** Search/filter the audit trail with pagination. */
  async findAll(
    query: QueryAuditLogDto,
  ): Promise<PaginatedResultDto<AuditLog>> {
    const qb = this.auditRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.userId) {
      qb.andWhere('log.userId = :userId', { userId: query.userId });
    }
    if (query.category) {
      qb.andWhere('log.category = :category', { category: query.category });
    }
    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }
    if (query.outcome) {
      qb.andWhere('log.outcome = :outcome', { outcome: query.outcome });
    }
    if (query.resourceType) {
      qb.andWhere('log.resourceType = :resourceType', {
        resourceType: query.resourceType,
      });
    }
    if (query.resourceId) {
      qb.andWhere('log.resourceId = :resourceId', {
        resourceId: query.resourceId,
      });
    }
    if (query.from) {
      qb.andWhere('log.createdAt >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('log.createdAt <= :to', { to: new Date(query.to) });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<AuditLog> {
    const log = await this.auditRepository.findOne({ where: { id } });
    if (!log) {
      throw new NotFoundException(`Audit log ${id} not found`);
    }
    return log;
  }

  /** The most recent activities, for the security team's real-time dashboard. */
  async recentActivities(limit = 100): Promise<AuditLog[]> {
    return this.auditRepository.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  /**
   * GDPR data-subject export: every audit record referencing a given user.
   * Returned in full (unpaginated) so it can be handed over as the subject's
   * activity record.
   */
  async exportForUser(userId: string): Promise<AuditLog[]> {
    return this.auditRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Records eligible for archival to cold storage: those older than the
   * retention window. This intentionally only *reads* candidates — the
   * append-only table is never deleted from here; archival/cold-storage
   * movement is an operational step performed on the returned set.
   */
  async findArchivable(now: Date = new Date()): Promise<AuditLog[]> {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - AUDIT_RETENTION_YEARS);
    return this.auditRepository.find({
      where: { createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
    });
  }

  /** Generate a compliance report in the requested format. */
  async generateReport(dto: GenerateReportDto): Promise<RenderedReport> {
    const logs = await this.collectReportRows(dto);
    const table = this.buildTable(dto, logs);
    const format = dto.format ?? ReportFormat.CSV;

    switch (format) {
      case ReportFormat.PDF:
        return {
          filename: `${dto.type}-report.pdf`,
          contentType: 'application/pdf',
          content: toPdf(table),
        };
      case ReportFormat.JSON:
        return {
          filename: `${dto.type}-report.json`,
          contentType: 'application/json',
          content: Buffer.from(JSON.stringify(table, null, 2), 'utf-8'),
        };
      case ReportFormat.CSV:
      default:
        return {
          filename: `${dto.type}-report.csv`,
          contentType: 'text/csv',
          content: Buffer.from(toCsv(table), 'utf-8'),
        };
    }
  }

  /** Select the audit rows relevant to a given report type/window. */
  private async collectReportRows(dto: GenerateReportDto): Promise<AuditLog[]> {
    const where: Record<string, unknown> = {};

    switch (dto.type) {
      case ComplianceReportType.TRANSACTIONS:
        where.resourceType = 'transaction';
        break;
      case ComplianceReportType.ADMIN_ACTIONS:
        where.category = AuditCategory.ADMIN_ACTION;
        break;
      case ComplianceReportType.SECURITY:
        where.category = AuditCategory.SECURITY;
        break;
      case ComplianceReportType.USER_ACTIVITY:
        if (dto.userId) {
          where.userId = dto.userId;
        }
        break;
    }

    if (dto.from && dto.to) {
      where.createdAt = Between(new Date(dto.from), new Date(dto.to));
    } else if (dto.from) {
      where.createdAt = LessThan(new Date());
    }

    return this.auditRepository.find({
      where,
      order: { createdAt: 'ASC' },
    });
  }

  /** Flatten audit rows into the tabular shape the writers consume. */
  private buildTable(dto: GenerateReportDto, logs: AuditLog[]): ReportTable {
    const columns = [
      'timestamp',
      'category',
      'action',
      'outcome',
      'userId',
      'userRole',
      'resourceType',
      'resourceId',
      'statusCode',
    ];
    const rows = logs.map((log) => [
      log.createdAt?.toISOString() ?? '',
      log.category ?? '',
      log.action ?? '',
      log.outcome ?? '',
      log.userId ?? '',
      log.userRole ?? '',
      log.resourceType ?? '',
      log.resourceId ?? '',
      log.statusCode != null ? String(log.statusCode) : '',
    ]);

    return {
      title: dto.title ?? `Compliance report: ${dto.type.replace(/_/g, ' ')}`,
      generatedAt: new Date().toISOString(),
      columns,
      rows,
    };
  }
}
