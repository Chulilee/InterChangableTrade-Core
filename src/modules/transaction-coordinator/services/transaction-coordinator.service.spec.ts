import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionCoordinatorService } from './transaction-coordinator.service';
import { AtomicBatchExecutorService } from './atomic-batch-executor.service';
import { TransactionGraphBuilderService } from './transaction-graph-builder.service';
import { StateConsistencyCheckerService } from './state-consistency-checker.service';
import { RetryLogicService } from './retry-logic.service';
import { TransactionBatch, BatchStatus } from '../entities/transaction-batch.entity';
import { BatchLeg, LegStatus } from '../entities/batch-leg.entity';
import {
  BatchAuditLog,
  BatchAuditAction,
} from '../entities/batch-audit-log.entity';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { QueryBatchDto } from '../dto/query-batch.dto';

/**
 * Unit tests for TransactionCoordinatorService (issue #98).
 *
 * Hermetic: TypeORM repositories, the executor, the retry logic and the
 * event emitter are hand-written fakes; the graph builder runs for real.
 * No network, no database, no wall-clock dependence (fake timers are used
 * where the timeout path is exercised).
 *
 * KNOWN DEFECTS (issue #98) pinned by this suite:
 * - executeBatch / prepareBatch / commitBatch / getAuditTrail accept any
 *   batchId with no ownership or caller check — an IDOR surface in
 *   contrast to cancelBatch, which does verify ownership.
 * - executeWithTimeout never resolves if handleBatchTimeout throws, so the
 *   pending HTTP request hangs forever (it.todo).
 */

const T0 = new Date('2026-06-01T00:00:00.000Z');

function makeBatch(over: Partial<TransactionBatch> = {}): TransactionBatch {
  return {
    id: 'batch-1',
    userId: 'user-1',
    name: 'Test batch',
    status: BatchStatus.CREATED,
    totalLegs: 2,
    preparedLegs: 0,
    committedLegs: 0,
    completionRate: null,
    sequenceNumber: 1748774400000,
    timeoutMs: 30000,
    hasConditionals: false,
    resultSummary: null,
    errorMessage: null,
    metadata: null,
    expiresAt: new Date(T0.getTime() + 30000),
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as TransactionBatch;
}

function makeLeg(
  orderIndex: number,
  over: Partial<BatchLeg> = {},
): BatchLeg {
  return {
    id: `leg-${orderIndex}`,
    batchId: 'batch-1',
    orderIndex,
    dependencies: [],
    contractId: `contract-${orderIndex}`,
    method: 'swap',
    args: {},
    sourceAssetCode: 'XLM',
    destAssetCode: 'USDC',
    amount: '100',
    minAmountOut: '50',
    maxAmountOut: null,
    status: LegStatus.PENDING,
    isConditional: false,
    conditionExpression: null,
    conditionType: null,
    expectedOutput: null,
    actualOutput: null,
    stellarTxHash: null,
    errorMessage: null,
    executionMetadata: null,
    preparedAt: null,
    executedAt: null,
    rolledBackAt: null,
    retryCount: 0,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as BatchLeg;
}

function makeDto(over: Partial<CreateBatchDto> = {}): CreateBatchDto {
  return {
    name: 'Test batch',
    legs: [
      {
        contractId: 'contract-0',
        method: 'swap',
        args: {},
        sourceAssetCode: 'XLM',
        destAssetCode: 'USDC',
        amount: 100,
        minAmountOut: 50,
      },
      {
        contractId: 'contract-1',
        method: 'swap',
        args: {},
        sourceAssetCode: 'USDC',
        destAssetCode: 'EUR',
        amount: 80,
        minAmountOut: 40,
        dependencies: [0],
      },
    ],
    timeoutMs: 30000,
    ...over,
  } as CreateBatchDto;
}

describe('TransactionCoordinatorService (issue #98)', () => {
  let batchRepo: any;
  let legRepo: any;
  let auditRepo: any;
  let batchExecutor: any;
  let eventEmitter: { emit: jest.Mock };
  let audits: BatchAuditLog[];
  let legs: BatchLeg[];
  let moduleRef: TestingModule | undefined;

  async function build(): Promise<TransactionCoordinatorService> {
    audits = [];
    legs = [];
    let auditSeq = 0;
    let batchSeq = 0;
    let legSeq = 0;

    batchRepo = {
      create: jest.fn((data: any) => ({
        id: `batch-${++batchSeq}`,
        ...data,
        createdAt: T0,
        updatedAt: T0,
      })),
      save: jest.fn(async (b: any) => b),
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 3),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          orderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn(async () => [[], 0]),
          getRawMany: jest.fn(async () => [{ status: 'committed', count: '3' }]),
          getRawOne: jest.fn(async () => ({ avgLegs: '2.5', avgRate: '97.5' })),
        };
        return qb;
      }),
    };

    legRepo = {
      create: jest.fn((data: any) => ({
        id: `leg-${++legSeq}`,
        ...data,
        createdAt: T0,
        updatedAt: T0,
      })),
      save: jest.fn(async (l: any) => l),
      find: jest.fn(async () => legs),
    };

    auditRepo = {
      create: jest.fn(
        (data: any) =>
          ({ ...data, id: `audit-${++auditSeq}` }) as BatchAuditLog,
      ),
      save: jest.fn(async (a: any) => {
        const rows = Array.isArray(a) ? a : [a];
        audits.push(...rows);
        return a;
      }),
      find: jest.fn(async () => audits),
    };

    batchExecutor = {
      preparePhase: jest.fn(async () => undefined),
      commitPhase: jest.fn(async () => ({
        batchId: 'batch-1',
        status: 'committed',
        committedLegs: 2,
        failedLegs: 0,
        skippedLegs: 0,
        totalDurationMs: 0,
      })),
      executeBatch: jest.fn(async () => ({
        batchId: 'batch-1',
        status: 'committed',
        committedLegs: 2,
        failedLegs: 0,
        skippedLegs: 0,
        totalDurationMs: 12,
      })),
    };

    eventEmitter = { emit: jest.fn() };

    moduleRef = await Test.createTestingModule({
      providers: [
        TransactionCoordinatorService,
        TransactionGraphBuilderService,
        {
          provide: getRepositoryToken(TransactionBatch),
          useValue: batchRepo,
        },
        { provide: getRepositoryToken(BatchLeg), useValue: legRepo },
        { provide: getRepositoryToken(BatchAuditLog), useValue: auditRepo },
        {
          provide: StateConsistencyCheckerService,
          useValue: {},
        },
        { provide: AtomicBatchExecutorService, useValue: batchExecutor },
        { provide: RetryLogicService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    return moduleRef.get(TransactionCoordinatorService);
  }

  afterEach(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
  });

  describe('createBatch', () => {
    it('rejects a batch with no legs', async () => {
      const service = await build();
      await expect(
        service.createBatch('user-1', makeDto({ legs: [] })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a leg that depends on a later leg', async () => {
      const service = await build();
      const dto = makeDto({
        legs: [
          {
            contractId: 'contract-0',
            method: 'swap',
            args: {},
            sourceAssetCode: 'XLM',
            destAssetCode: 'USDC',
            amount: 100,
            minAmountOut: 50,
            dependencies: [1],
          },
          {
            contractId: 'contract-1',
            method: 'swap',
            args: {},
            sourceAssetCode: 'USDC',
            destAssetCode: 'EUR',
            amount: 80,
            minAmountOut: 40,
          },
        ],
      });

      await expect(service.createBatch('user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates a batch, stores stringly-typed order_N dependencies and audits it', async () => {
      const service = await build();

      const batch = await service.createBatch('user-1', makeDto());

      expect(batchRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          status: BatchStatus.CREATED,
          totalLegs: 2,
        }),
      );
      expect(legRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ orderIndex: 0, dependencies: [] }),
          expect.objectContaining({ orderIndex: 1, dependencies: ['order_0'] }),
        ]),
      );
      expect(typeof batch.sequenceNumber).toBe('number');
      expect(
        audits.map((a) => a.action),
      ).toContain(BatchAuditAction.BATCH_CREATED);
    });
  });

  describe('executeBatch', () => {
    it('refuses to execute a batch that is not in CREATED status', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ status: BatchStatus.COMMITTED }),
      );

      await expect(service.executeBatch('batch-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(batchExecutor.executeBatch).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(null);

      await expect(service.executeBatch('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the executor result for a CREATED batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ status: BatchStatus.CREATED }),
      );

      const result = await service.executeBatch('batch-1');

      expect(result.status).toBe('committed');
      expect(batchExecutor.executeBatch).toHaveBeenCalledTimes(1);
    });

    // KNOWN DEFECT (issue #98): executeBatch performs NO ownership check —
    // any caller can execute any CREATED batch they know the id of, in
    // contrast to cancelBatch which requires the caller to own the batch.
    it('documents the IDOR defect: any caller can execute any CREATED batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ status: BatchStatus.CREATED, userId: 'owner-a' }),
      );

      // No user/caller context is passed or verified.
      const result = await service.executeBatch('batch-1');

      expect(result.status).toBe('committed');
      expect(batchExecutor.executeBatch).toHaveBeenCalledTimes(1);
    });

    it('resolves with a failed result when the batch times out', async () => {
      jest.useFakeTimers();
      const service = await build();

      const batch = makeBatch({
        status: BatchStatus.CREATED,
        timeoutMs: 30000,
      });
      batchRepo.findOne.mockResolvedValue(batch);
      legs = [makeLeg(0, { status: LegStatus.PREPARED })];
      legRepo.find.mockResolvedValue(legs);
      batchExecutor.executeBatch.mockReturnValue(
        new Promise(() => undefined), // never settles: only the timeout fires
      );

      const promise = service.executeBatch('batch-1');
      await jest.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out');
      expect(batch.status).toBe(BatchStatus.EXPIRED);
      expect(eventEmitter.emit).toHaveBeenCalledWith('batch.expired', {
        batchId: 'batch-1',
      });
    });

    it.todo(
      'executeWithTimeout: if handleBatchTimeout throws, the returned promise never settles — the HTTP request hangs forever (issue #98). Wrap the timeout handler in try/catch and reject or resolve',
    );
  });

  describe('prepareBatch / commitBatch', () => {
    it('prepareBatch rejects a batch that is not in CREATED status', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ status: BatchStatus.PREPARED }),
      );

      await expect(service.prepareBatch('batch-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('prepareBatch delegates to the executor and returns the refreshed batch', async () => {
      const service = await build();
      const batch = makeBatch({ status: BatchStatus.CREATED });
      batchRepo.findOne.mockResolvedValue(batch);
      legs = [makeLeg(0), makeLeg(1)];
      legRepo.find.mockResolvedValue(legs);

      const refreshed = await service.prepareBatch('batch-1');

      expect(batchExecutor.preparePhase).toHaveBeenCalledWith(batch, legs);
      expect(refreshed.id).toBe(batch.id);
      expect(batchRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('commitBatch rejects a batch that has not been prepared', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ status: BatchStatus.CREATED }),
      );

      await expect(service.commitBatch('batch-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(batchExecutor.commitPhase).not.toHaveBeenCalled();
    });

    it('commitBatch delegates to the executor for a PREPARED batch', async () => {
      const service = await build();
      const batch = makeBatch({ status: BatchStatus.PREPARED });
      batchRepo.findOne.mockResolvedValue(batch);
      legs = [makeLeg(0, { status: LegStatus.PREPARED })];
      legRepo.find.mockResolvedValue(legs);

      const result = await service.commitBatch('batch-1');

      expect(result.status).toBe('committed');
      expect(batchExecutor.commitPhase).toHaveBeenCalledWith(batch, legs);
    });

    // KNOWN DEFECT (issue #98): like executeBatch, neither prepareBatch nor
    // commitBatch verifies the caller owns the batch they act on.
    it.todo(
      'enforce batch ownership in executeBatch / prepareBatch / commitBatch / getAuditTrail (issue #98)',
    );
  });

  describe('cancelBatch', () => {
    it('rejects cancellation by a different user', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ userId: 'owner-a', status: BatchStatus.CREATED }),
      );

      await expect(
        service.cancelBatch('batch-1', 'intruder'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cancellation of an already-committed batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ userId: 'user-1', status: BatchStatus.COMMITTED }),
      );

      await expect(
        service.cancelBatch('batch-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks prepared legs as rolled back and audits the cancellation', async () => {
      const service = await build();
      const batch = makeBatch({
        userId: 'user-1',
        status: BatchStatus.PREPARED,
      });
      batchRepo.findOne.mockResolvedValue(batch);
      const prepared = makeLeg(0, { status: LegStatus.PREPARED });
      legs = [prepared];
      legRepo.find.mockResolvedValue(legs);

      const cancelled = await service.cancelBatch('batch-1', 'user-1');

      expect(prepared.status).toBe(LegStatus.ROLLED_BACK);
      expect(cancelled.status).toBe(BatchStatus.ROLLED_BACK);
      expect(cancelled.errorMessage).toContain('user-1');
      expect(
        audits.map((a) => a.action),
      ).toContain(BatchAuditAction.BATCH_ROLLED_BACK);
      expect(
        audits.find((a) => a.action === BatchAuditAction.BATCH_ROLLED_BACK)
          ?.metadata,
      ).toMatchObject({ reason: 'user_cancel' });
    });
  });

  describe('getAuditTrail', () => {
    it('returns the audit log for an existing batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(makeBatch());
      audits = [
        {
          id: 'audit-1',
          batchId: 'batch-1',
          action: BatchAuditAction.BATCH_CREATED,
          actorId: 'user-1',
        } as BatchAuditLog,
      ];

      const trail = await service.getAuditTrail('batch-1');

      expect(trail).toHaveLength(1);
      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('throws NotFoundException for an unknown batch', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(null);

      await expect(service.getAuditTrail('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // KNOWN DEFECT (issue #98): getAuditTrail exposes the full audit log of
    // any batch to any caller — no ownership or authorization context.
    it('documents the IDOR defect: the audit trail is served for any batchId', async () => {
      const service = await build();
      batchRepo.findOne.mockResolvedValue(
        makeBatch({ userId: 'owner-a' }),
      );

      const trail = await service.getAuditTrail('batch-1');

      expect(trail).toEqual([]);
      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('handleBatchTimeout', () => {
    it('expires a running batch and rolls back its non-final legs', async () => {
      const service = await build();
      const batch = makeBatch({
        status: BatchStatus.COMMITTING,
        timeoutMs: 30000,
      });
      batchRepo.findOne.mockResolvedValue(batch);
      const executing = makeLeg(0, { status: LegStatus.EXECUTING });
      const done = makeLeg(1, { status: LegStatus.EXECUTED });
      legs = [executing, done];
      legRepo.find.mockResolvedValue(legs);

      await service.handleBatchTimeout('batch-1');

      expect(batch.status).toBe(BatchStatus.EXPIRED);
      expect(executing.status).toBe(LegStatus.ROLLED_BACK);
      expect(done.status).toBe(LegStatus.ROLLED_BACK);
      expect(eventEmitter.emit).toHaveBeenCalledWith('batch.expired', {
        batchId: 'batch-1',
      });
      expect(
        audits.map((a) => a.action),
      ).toContain(BatchAuditAction.BATCH_EXPIRED);
    });

    it('ignores a batch that is already in a terminal status', async () => {
      const service = await build();
      const batch = makeBatch({ status: BatchStatus.COMMITTED });
      batchRepo.findOne.mockResolvedValue(batch);

      await service.handleBatchTimeout('batch-1');

      expect(batch.status).toBe(BatchStatus.COMMITTED);
      expect(batchRepo.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('listBatches', () => {
    it('returns a paginated envelope for the current user', async () => {
      const service = await build();

      const query = {
        page: 1,
        limit: 10,
        skip: 0,
      } as unknown as QueryBatchDto;

      const page = await service.listBatches('user-1', query);

      expect(page.data).toEqual([]);
      expect(page.meta).toMatchObject({ page: 1, limit: 10, total: 0 });
    });
  });

  describe('getStatistics', () => {
    it('aggregates totals, status counts and averages', async () => {
      const service = await build();

      const stats = await service.getStatistics();

      expect(stats).toEqual({
        totalBatches: 3,
        statusCounts: { committed: 3 },
        avgLegsPerBatch: 2.5,
        avgCompletionRate: 97.5,
      });
    });
  });
});
