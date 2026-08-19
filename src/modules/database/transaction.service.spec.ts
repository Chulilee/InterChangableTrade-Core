import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TransactionService } from './transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockDataSource = {
      createQueryRunner: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get(TransactionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeInTransaction', () => {
    it('should execute callback within a transaction', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      const callback = jest.fn().mockResolvedValue('result');

      const result = await service.executeInTransaction(callback);

      expect(result).toBe('result');
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should retry on failure', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      let callCount = 0;
      const callback = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient error');
        }
        return Promise.resolve('success');
      });

      const result = await service.executeInTransaction(callback, {
        retryAttempts: 3,
        retryDelay: 10,
      });

      expect(result).toBe('success');
      expect(callCount).toBe(3);
    });

    it('should throw after max retries', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      const callback = jest.fn().mockRejectedValue(new Error('Persistent error'));

      await expect(
        service.executeInTransaction(callback, {
          retryAttempts: 2,
          retryDelay: 10,
        }),
      ).rejects.toThrow('Persistent error');
    });
  });

  describe('executeReadOnly', () => {
    it('should execute with READ UNCOMMITTED isolation', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
      };

      mockDataSource.createQueryRunner = jest.fn().mockReturnValue(mockQueryRunner as any);

      const callback = jest.fn().mockResolvedValue('result');

      await service.executeReadOnly(callback);

      expect(mockQueryRunner.startTransaction).toHaveBeenCalledWith('READ UNCOMMITTED');
    });
  });
});
