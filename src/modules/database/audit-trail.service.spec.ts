import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { AuditTrailService, AuditAction } from './audit-trail.service';

describe('AuditTrailService', () => {
  let service: AuditTrailService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    mockDataSource = {
      createQueryRunner: jest.fn(),
      manager: {
        insert: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      } as any,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditTrailService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get(AuditTrailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isAudited', () => {
    it('should return true for audited tables', () => {
      expect(service.isAudited('users')).toBe(true);
      expect(service.isAudited('wallets')).toBe(true);
      expect(service.isAudited('orders')).toBe(true);
    });

    it('should return false for non-audited tables', () => {
      expect(service.isAudited('unknown_table')).toBe(false);
      expect(service.isAudited('test')).toBe(false);
    });
  });

  describe('registerAuditedTable', () => {
    it('should register new audited table', () => {
      service.registerAuditedTable('custom_table');

      expect(service.isAudited('custom_table')).toBe(true);
    });
  });

  describe('log', () => {
    it('should log audit entry for audited table', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        manager: {
          insert: jest.fn().mockResolvedValue(undefined),
        },
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      await service.log({
        entityType: 'users',
        entityId: '123',
        action: AuditAction.CREATED,
        newState: { name: 'John' },
      });

      expect(mockQueryRunner.manager.insert).toHaveBeenCalled();
    });

    it('should not log for non-audited table', async () => {
      await service.log({
        entityType: 'non_audited',
        entityId: '123',
        action: AuditAction.CREATED,
      });

      expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
    });
  });

  describe('findAuditTrail', () => {
    it('should return audit trail for entity', async () => {
      const mockAuditTrails = [
        { id: 1, action: 'created' },
        { id: 2, action: 'updated' },
      ];

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockAuditTrails),
      };

      mockDataSource.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);

      const result = await service.findAuditTrail('users', '123', 10);

      expect(result).toEqual(mockAuditTrails);
    });
  });

  describe('getEntityHistory', () => {
    it('should return entity history', async () => {
      const mockHistory = [
        { id: 1, entityId: '123', action: 'created' },
        { id: 2, entityId: '123', action: 'updated' },
      ];

      mockDataSource.manager.query = jest.fn().mockResolvedValue(mockHistory);

      const result = await service.getEntityHistory('123', 100);

      expect(result).toEqual(mockHistory);
      expect(mockDataSource.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM audit_trails'),
        ['123', 100],
      );
    });
  });
});
