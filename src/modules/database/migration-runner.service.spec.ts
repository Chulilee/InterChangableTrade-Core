import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MigrationRunnerService } from './migration-runner.service';
import { DataSource } from 'typeorm';

describe('MigrationRunnerService', () => {
  let service: MigrationRunnerService;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn(),
      runMigrations: jest.fn(),
      createQueryRunner: jest.fn(),
      options: { migrationsDir: 'src/migrations' },
    } as any;

    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationRunnerService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(MigrationRunnerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return migration status', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([
          { name: 'migration1.ts', executed_at: '2024-01-01T00:00:00Z' },
          { name: 'migration2.ts', executed_at: '2024-01-02T00:00:00Z' },
        ])
        .mockResolvedValueOnce([]);

      const status = await service.getStatus();

      expect(status.executed.length).toBe(2);
      expect(status.pending.length).toBe(0);
    });

    it('should identify pending migrations', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ name: 'migration1.ts', executed_at: '2024-01-01T00:00:00Z' }])
        .mockResolvedValueOnce([{ timestamp: 1000, name: 'migration1.ts' }]);

      mockDataSource.query = jest.fn();

      const fs = require('fs');
      const originalReaddirSync = fs.readdirSync;
      fs.readdirSync = jest.fn().mockReturnValue(['1000-migration1.ts']);

      const status = await service.getStatus();

      expect(status.executed.length).toBe(1);
      expect(status.pending.length).toBe(0);

      fs.readdirSync = originalReaddirSync;
    });
  });

  describe('runMigrations', () => {
    it('should run pending migrations', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ name: 'migration1.ts', executed_at: '2024-01-01T00:00:00Z' }])
        .mockResolvedValueOnce([{ timestamp: 1000, name: 'migration1.ts' }]);

      mockDataSource.runMigrations = jest.fn().mockResolvedValue(undefined);

      const result = await service.runMigrations();

      expect(result.executed).toBe(0);
    });
  });

  describe('rollbackMigration', () => {
    it('should rollback specified number of migrations', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);
      mockDataSource.query = jest.fn()
        .mockResolvedValueOnce([{ name: 'migration1.ts', executed_at: '2024-01-01T00:00:00Z' }])
        .mockResolvedValueOnce([{ timestamp: 1000, name: 'migration1.ts' }]);

      const result = await service.rollbackMigration(1);

      expect(result.rolledBack).toBe(1);
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'DELETE FROM typeorm_migrations WHERE name = $1',
        ['migration1.ts'],
      );
    });
  });
});
