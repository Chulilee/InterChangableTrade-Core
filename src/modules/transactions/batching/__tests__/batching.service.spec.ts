import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import {
  Transaction,
  TransactionStatus,
} from '../../entities/transaction.entity';
import {
  BatchStatus,
  BatchTrigger,
  SettlementBatch,
} from '../entities/settlement-batch.entity';
import { BatchingService } from '../batching.service';
import { NetSettlementService } from '../net-settlement.service';
import { SETTLEMENT_EXECUTOR } from '../settlement-executor';

const makeTx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-' + Math.random().toString(36).slice(2),
    status: TransactionStatus.PENDING,
    assetCode: 'XLM',
    assetIssuer: null,
    amount: '1',
    fromAccount: 'A',
    toAccount: 'B',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as Transaction;

describe('BatchingService', () => {
  let service: BatchingService;
  let txRepo: Record<string, jest.Mock>;
  let batchRepo: Record<string, jest.Mock>;
  let executor: { execute: jest.Mock; rollback: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let config: Record<string, jest.Mock>;

  beforeEach(async () => {
    txRepo = { find: jest.fn().mockResolvedValue([]) };
    batchRepo = {
      create: jest.fn((x) => ({ id: 'batch-1', ...x })),
      save: jest.fn(async (x) => x),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    executor = {
      execute: jest.fn().mockResolvedValue({ hash: '0xhash', ledger: 42 }),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    // By default the DB transaction just runs the callback with entity
    // managers backed by the same mocks.
    dataSource = {
      transaction: jest.fn(async (cb) =>
        cb({
          getRepository: () => ({
            update: jest.fn().mockResolvedValue({}),
            save: jest.fn(async (b) => b),
          }),
        }),
      ),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'batching.sizeThreshold'
          ? 50
          : key === 'batching.windowMs'
            ? 30_000
            : undefined,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BatchingService,
        NetSettlementService,
        { provide: getRepositoryToken(Transaction), useValue: txRepo },
        { provide: getRepositoryToken(SettlementBatch), useValue: batchRepo },
        { provide: SETTLEMENT_EXECUTOR, useValue: executor },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get<BatchingService>(BatchingService);
  });

  describe('trigger evaluation', () => {
    it('is idle with an empty queue', async () => {
      const status = await service.evaluateTriggers();
      expect(status.pendingCount).toBe(0);
      expect(await service.onTick()).toBeNull();
    });

    it('fires the size trigger at exactly 50 pending transactions', async () => {
      const recent = new Date(Date.now() - 1_000);
      txRepo.find.mockResolvedValue(
        Array.from({ length: 50 }, () => makeTx({ createdAt: recent })),
      );
      const status = await service.evaluateTriggers();
      expect(status.sizeThresholdReached).toBe(true);
      expect(status.timeThresholdReached).toBe(false); // window not yet elapsed
    });

    it('fires the time trigger once the oldest pending transaction is older than the window', async () => {
      const stale = new Date(Date.now() - 31_000);
      txRepo.find.mockResolvedValue([makeTx({ createdAt: stale })]);

      const status = await service.evaluateTriggers(new Date());
      expect(status.timeThresholdReached).toBe(true);
      expect(status.sizeThresholdReached).toBe(false);
      expect(status.windowOpenedAt).toEqual(stale);

      const fresh = new Date(Date.now() - 5_000);
      txRepo.find.mockResolvedValue([makeTx({ createdAt: fresh })]);
      expect((await service.evaluateTriggers()).timeThresholdReached).toBe(
        false,
      );
    });

    it('onTick executes with the SIZE trigger when size fires first', async () => {
      txRepo.find.mockResolvedValue(Array.from({ length: 50 }, () => makeTx()));
      const spy = jest.spyOn(service, 'executeBatch');
      await service.onTick();
      expect(spy).toHaveBeenCalledWith(BatchTrigger.SIZE, expect.any(Date));
    });
  });

  describe('executeBatch', () => {
    it('nets, executes and settles all members atomically', async () => {
      const members = [
        makeTx({ id: 't1', amount: '10' }),
        makeTx({ id: 't2', fromAccount: 'B', toAccount: 'A', amount: '4' }),
      ];
      txRepo.find.mockResolvedValue(members);

      const batch = await service.executeBatch(BatchTrigger.MANUAL);

      // Two opposing flows netted into a single 6-unit transfer.
      expect(executor.execute).toHaveBeenCalledTimes(1);
      const transfers = executor.execute.mock.calls[0][0];
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        fromAccount: 'A',
        toAccount: 'B',
        amount: '6',
      });

      expect(batch!.status).toBe(BatchStatus.SETTLED);
      expect(batch!.transactionCount).toBe(2);
      expect(batch!.transactionIds.sort()).toEqual(['t1', 't2']);
      expect(batch!.stellarTxHash).toBe('0xhash');
      expect(batch!.feeAnalysis?.savingsPercent).toBe('50.00');
      expect(batch!.processingMs).toBeLessThan(2_000);
    });

    it('records rejected transactions during composition validation', async () => {
      txRepo.find.mockResolvedValue([
        makeTx({ id: 'good', amount: '5' }),
        makeTx({ id: 'bad', fromAccount: '' }),
      ]);
      const batch = await service.executeBatch(BatchTrigger.TIME);
      expect(batch!.rejected).toEqual([
        { transactionId: 'bad', reason: 'missing from/to account' },
      ]);
      expect(batch!.transactionCount).toBe(1);
    });

    it('rolls back and leaves members untouched when execution fails', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      executor.execute.mockRejectedValue(new Error('ledger unavailable'));

      const batch = await service.executeBatch(BatchTrigger.SIZE);

      expect(executor.rollback).toHaveBeenCalledTimes(1);
      expect(batch!.status).toBe(BatchStatus.FAILED);
      expect(batch!.failureReason).toContain('ledger unavailable');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns null (no batch) when every candidate is invalid', async () => {
      txRepo.find.mockResolvedValue([makeTx({ amount: '0' })]);
      expect(await service.executeBatch(BatchTrigger.MANUAL)).toBeNull();
      expect(executor.execute).not.toHaveBeenCalled();
    });

    it('does not re-enter while an execution is in flight', async () => {
      let release!: () => void;
      executor.execute.mockImplementation(
        () =>
          new Promise(
            (resolve) =>
              (release = () => resolve({ hash: null, ledger: null })),
          ),
      );
      txRepo.find.mockImplementation(async () => [makeTx()]);

      const first = service.onTick();
      // Give the first tick a chance to start executing, then fire again.
      await Promise.resolve();
      await Promise.resolve();
      const second = await service.onTick();
      expect(second).toBeNull();

      release();
      const batch = await first;
      expect(batch!.status).toBe(BatchStatus.SETTLED);
    });

    it('propagates persistence failures after successful execution as FAILED batches', async () => {
      txRepo.find.mockResolvedValue([makeTx()]);
      dataSource.transaction.mockRejectedValue(new Error('db down'));

      const batch = await service.executeBatch(BatchTrigger.MANUAL);
      expect(batch!.status).toBe(BatchStatus.FAILED);
      expect(batch!.failureReason).toContain('db down');
    });
  });

  describe('manual trigger & queries', () => {
    it('throws when there is nothing to settle manually', async () => {
      txRepo.find.mockResolvedValue([]);
      await expect(service.triggerManual()).rejects.toThrow(NotFoundException);
    });

    it('findOne 404s on unknown ids', async () => {
      batchRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });

    it('findHistory filters by status', async () => {
      await service.findHistory(BatchStatus.SETTLED);
      expect(batchRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: BatchStatus.SETTLED } }),
      );
      await service.findHistory();
      expect(batchRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });
});
