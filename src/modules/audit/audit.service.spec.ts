import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AuditService, AUDIT_RETENTION_YEARS } from './audit.service';
import {
  AuditCategory,
  AuditLog,
  AuditOutcome,
} from './entities/audit-log.entity';
import { ComplianceReportType, ReportFormat } from './dto/generate-report.dto';

/** Minimal query-builder stub whose terminal call resolves to `result`. */
function mockQueryBuilder(result: [AuditLog[], number]) {
  const qb: Record<string, jest.Mock> = {};
  ['orderBy', 'skip', 'take', 'andWhere'].forEach((m) => {
    qb[m] = jest.fn().mockReturnValue(qb);
  });
  qb.getManyAndCount = jest.fn().mockResolvedValue(result);
  return qb;
}

function makeLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    category: AuditCategory.USER_ACTION,
    action: 'GET /trades',
    outcome: AuditOutcome.SUCCESS,
    userId: 'user-1',
    userRole: 'user',
    resourceType: 'trades',
    resourceId: null,
    httpMethod: 'GET',
    path: '/trades',
    statusCode: 200,
    durationMs: 3,
    ipAddress: null,
    userAgent: null,
    requestId: null,
    beforeState: null,
    afterState: null,
    metadata: null,
    ...overrides,
  } as AuditLog;
}

describe('AuditService', () => {
  let service: AuditService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'generated-id', ...v })),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  describe('append', () => {
    it('inserts a record with default category and outcome', async () => {
      await service.append({ action: 'user.login' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.login',
          category: AuditCategory.SYSTEM_EVENT,
          outcome: AuditOutcome.SUCCESS,
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('preserves an explicit category and outcome', async () => {
      await service.append({
        action: 'admin.user.suspend',
        category: AuditCategory.ADMIN_ACTION,
        outcome: AuditOutcome.FAILURE,
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          category: AuditCategory.ADMIN_ACTION,
          outcome: AuditOutcome.FAILURE,
        }),
      );
    });
  });

  describe('record (fire-and-forget)', () => {
    it('does not throw when the underlying append rejects', async () => {
      repo.save.mockRejectedValueOnce(new Error('db down'));
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      expect(() => service.record({ action: 'x' })).not.toThrow();
      // let the rejected promise settle
      await new Promise((r) => setImmediate(r));
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('applies filters and returns a paginated envelope', async () => {
      const qb = mockQueryBuilder([[makeLog()], 1]);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        skip: 0,
        userId: 'user-1',
        category: AuditCategory.USER_ACTION,
        action: 'GET /trades',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'trades',
        resourceId: 'r1',
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-02-01T00:00:00.000Z',
      } as never);

      expect(qb.andWhere).toHaveBeenCalledTimes(8);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns the record when found', async () => {
      const log = makeLog();
      repo.findOne.mockResolvedValue(log);
      await expect(service.findOne(log.id)).resolves.toBe(log);
    });

    it('throws NotFoundException when missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('recentActivities', () => {
    it('caps the limit at 100 and orders by createdAt desc', async () => {
      repo.find.mockResolvedValue([makeLog()]);
      await service.recentActivities(1000);
      expect(repo.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });
  });

  describe('exportForUser', () => {
    it('returns all records for a user in ascending order', async () => {
      repo.find.mockResolvedValue([makeLog()]);
      await service.exportForUser('user-1');
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findArchivable', () => {
    it('queries for records older than the retention window', async () => {
      repo.find.mockResolvedValue([]);
      const now = new Date('2031-06-15T00:00:00.000Z');
      await service.findArchivable(now);
      const arg = repo.find.mock.calls[0][0];
      const cutoff: Date =
        arg.where.createdAt._value ?? arg.where.createdAt.value;
      // LessThan wraps the cutoff; assert it is retention years before `now`.
      expect(now.getFullYear() - new Date(cutoff).getFullYear()).toBe(
        AUDIT_RETENTION_YEARS,
      );
    });
  });

  describe('generateReport', () => {
    beforeEach(() => {
      repo.find.mockResolvedValue([
        makeLog({ resourceType: 'transaction', action: 'POST /transactions' }),
      ]);
    });

    it('produces CSV by default with a header row', async () => {
      const report = await service.generateReport({
        type: ComplianceReportType.TRANSACTIONS,
        format: ReportFormat.CSV,
      });
      expect(report.contentType).toBe('text/csv');
      expect(report.filename).toBe('transactions-report.csv');
      const text = report.content.toString('utf-8');
      expect(text.split('\r\n')[0]).toContain('timestamp');
    });

    it('produces a valid PDF buffer', async () => {
      const report = await service.generateReport({
        type: ComplianceReportType.ADMIN_ACTIONS,
        format: ReportFormat.PDF,
      });
      expect(report.contentType).toBe('application/pdf');
      expect(report.content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(report.content.toString('latin1')).toContain('%%EOF');
    });

    it('produces JSON when requested', async () => {
      const report = await service.generateReport({
        type: ComplianceReportType.USER_ACTIVITY,
        format: ReportFormat.JSON,
        userId: '22222222-2222-2222-2222-222222222222',
      });
      expect(report.contentType).toBe('application/json');
      const parsed = JSON.parse(report.content.toString('utf-8'));
      expect(parsed.columns).toContain('action');
      expect(Array.isArray(parsed.rows)).toBe(true);
    });
  });
});
