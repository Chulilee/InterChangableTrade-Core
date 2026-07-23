import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { DataSource } from 'typeorm';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn(),
      driver: {
        options: {
          extra: {
            totalCount: 10,
            idleCount: 5,
            waitingCount: 0,
          },
        },
      } as any,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get(DatabaseService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('healthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      mockDataSource.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([{ pg_is_in_recovery: false }]);

      const result = await service.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.checks.connection).toBe(true);
      expect(result.checks.migration).toBe(true);
    });

    it('should return degraded status when replication check fails', async () => {
      mockDataSource.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: '5' }]);

      const result = await service.healthCheck();

      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy status when connection fails', async () => {
      mockDataSource.query.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.connection).toBe(false);
    });
  });

  describe('getDataSource', () => {
    it('should return the data source', () => {
      expect(service.getDataSource()).toBe(mockDataSource);
    });
  });

  describe('getQueryRunner', () => {
    it('should create a query runner', async () => {
      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        isTransactionActive: false,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      const queryRunner = await service.getQueryRunner();

      expect(queryRunner).toBeDefined();
    });
  });
});
