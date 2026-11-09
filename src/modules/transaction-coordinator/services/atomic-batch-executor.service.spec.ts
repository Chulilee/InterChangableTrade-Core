import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AtomicBatchExecutorService } from './atomic-batch-executor.service';
import { TransactionGraphBuilderService } from './transaction-graph-builder.service';
import { StateConsistencyCheckerService } from './state-consistency-checker.service';
import { TransactionBatch, BatchStatus } from '../entities/transaction-batch.entity';
import { BatchLeg, LegStatus } from '../entities/batch-leg.entity';
import {
  BatchAuditLog,
  BatchAuditAction,
} from '../entities/batch-audit-log.entity';
import { ContractInvocationService } from '../../stellar/soroban/contract-invocation.service';
import { GasOptimizationEngine } from '../../stellar/soroban/gas-optimizer.service';
import { RetryLogicService } from './retry-logic.service';

/**
 * Unit tests for AtomicBatchExecutorService (issue #98).
 *
 * Hermetic: TypeORM repositories are hand-written fakes; the graph builder
 * and the consistency checker run for real so the ordering semantics are the
 * production ones. No network, no database.
 *
 * KNOWN DEFECTS (issue #98) pinned by this suite:
 * - `rollbackLeg()` only flips the leg status to ROLLED_BACK; no inverse
 *   transaction is ever submitted, so a failed multi-leg commit leaves
 *   executed legs committed on-chain while the batch reports rolled_back.
 * - `buildGraphFromLegs()` matches dependency ids against `l.id`, but
 *   persisted dependencies are stringly-typed `order_N` placeholders — the
 *   lookup never matches, so dependent legs execute in arbitrary parallel
 *   layers.
 * - `executeLegCondition()` falls back to currentPrice = '0' when the price
 *   feed returns nothing (a `price_lt` condition always fires) and returns
 *   false when the RPC throws (a transient error silently SKIPS the leg).
 *
 * These tests document the real behaviour; fixes are tracked with it.todo.
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

describe('AtomicBatchExecutorService (issue #98)', () => {
  let legs: BatchLeg[];
  let audits: BatchAuditLog[];
  let legRepo: { find: jest.Mock; save: jest.Mock };
  let batchRepo: { save: jest.Mock; find: jest.Mock };
  let auditRepo: { create: jest.Mock; save: jest.Mock };
  let contractInvocation: { simulate: jest.Mock; invoke: jest.Mock };
  let gasOptimizer: { optimizeGas: jest.Mock; recordGasUsage: jest.Mock };
  let retryLogic: { executeWithRetry: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let moduleRef: TestingModule | undefined;

  async function build(): Promise<AtomicBatchExecutorService> {
    legs = [];
    audits = [];
    let auditSeq = 0;

    legRepo = {
      find: jest.fn(async (opts?: any) => {
        let rows = legs.filter(
          (l) => !opts?.where?.batchId || l.batchId === opts.where.batchId,
        );
        if (opts?.order?.orderIndex === 'DESC') {
          rows = [...rows].sort((a, b) => b.orderIndex - a.orderIndex);
        }
        return rows;
      }),
      save: jest.fn(async (l: BatchLeg) => l),
    };

    batchRepo = {
      save: jest.fn(async (b: TransactionBatch) => b),
      find: jest.fn(async () => []),
    };

    auditRepo = {
      create: jest.fn(
        (data: Partial<BatchAuditLog>) =>
          ({ ...data, id: `audit-${++auditSeq}` } as BatchAuditLog),
      ),
      save: jest.fn(async (a: BatchAuditLog) => {
        audits.push(a);
        return a;
      }),
    };

    contractInvocation = {
      simulate: jest.fn(async () => ({
        result: { amount_out: '80' },
        gas: { minResourceFee: '10' },
      })),
      invoke: jest.fn(async (req?: any) => ({
        transactionHash: `tx-${req?.contractId ?? 'unknown'}`,
        ledger: 424242,
        gas: { minResourceFee: '10' },
        result: { amount_out: '80' },
      })),
    };

    gasOptimizer = {
      optimizeGas: jest.fn(async () => ({
        optimizedEstimate: 100,
        optimizationsApplied: ['test'],
        estimatedSavings: 0,
      })),
      recordGasUsage: jest.fn(),
    };

    retryLogic = {
      executeWithRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
    };

    eventEmitter = { emit: jest.fn() };

    moduleRef = await Test.createTestingModule({
      providers: [
        AtomicBatchExecutorService,
        TransactionGraphBuilderService,
        StateConsistencyCheckerService,
        {
          provide: getRepositoryToken(TransactionBatch),
          useValue: batchRepo,
        },
        { provide: getRepositoryToken(BatchLeg), useValue: legRepo },
        { provide: getRepositoryToken(BatchAuditLog), useValue: auditRepo },
        { provide: RetryLogicService, useValue: retryLogic },
        { provide: ContractInvocationService, useValue: contractInvocation },
        { provide: GasOptimizationEngine, useValue: gasOptimizer },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    return moduleRef.get(AtomicBatchExecutorService);
  }

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('prepare → commit: independent legs all execute and the batch commits', async () => {
    const service = await build();
    legs.push(makeLeg(0), makeLeg(1));
    const batch = makeBatch({ status: BatchStatus.CREATED });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('committed');
    expect(result.committedLegs).toBe(2);
    expect(result.failedLegs).toBe(0);
    expect(legs.map((l) => l.status)).toEqual([
      LegStatus.EXECUTED,
      LegStatus.EXECUTED,
    ]);
    expect(batch.status).toBe(BatchStatus.COMMITTED);
    expect(batch.completionRate).toBe('100.00');
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'batch.committed',
      expect.objectContaining({ batchId: batch.id, committedLegs: 2 }),
    );

    const actions = audits.map((a) => a.action);
    expect(actions).toContain(BatchAuditAction.BATCH_PREPARED);
    expect(actions).toContain(BatchAuditAction.BATCH_COMMITTED);
    expect(actions).toContain(BatchAuditAction.LEG_EXECUTED);
  });

  it('commitPhase executes only after the prepare phase has completed', async () => {
    const service = await build();
    legs.push(makeLeg(0));
    const batch = makeBatch({ totalLegs: 1 });

    await service.preparePhase(batch, legs);
    expect(batch.status).toBe(BatchStatus.PREPARED);
    expect(legs[0].status).toBe(LegStatus.PREPARED);
    expect(legRepo.find).not.toHaveBeenCalled(); // legs were passed in directly

    const result = await service.commitPhase(batch, legs);
    expect(result.status).toBe('committed');
    expect(batch.status).toBe(BatchStatus.COMMITTED);
    expect(legs[0].status).toBe(LegStatus.EXECUTED);
  });

  // KNOWN DEFECT (issue #98): a leg that DID execute on-chain is marked
  // ROLLED_BACK in the database without any inverse transaction being
  // submitted. The batch therefore reports `rolled_back` while the chain
  // shows the swap committed.
  it('documents the rollback fiction: committed siblings are only flag-flipped, never inverted', async () => {
    const service = await build();
    legs.push(makeLeg(0), makeLeg(1));
    const batch = makeBatch({ status: BatchStatus.CREATED });

    contractInvocation.invoke.mockImplementation(async (req?: any) => {
      if (req?.contractId === 'contract-1') {
        throw new Error('contract reverted');
      }
      return {
        transactionHash: 'tx-contract-0',
        ledger: 424242,
        gas: { minResourceFee: '10' },
        result: { amount_out: '80' },
      };
    });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('rolled_back');
    expect(result.committedLegs).toBe(1);
    expect(result.failedLegs).toBe(1);

    // Leg 0 executed on-chain but is merely flagged ROLLED_BACK.
    expect(legs[0].status).toBe(LegStatus.ROLLED_BACK);
    expect(legs[0].stellarTxHash).toBe('tx-contract-0');
    expect(batch.status).toBe(BatchStatus.ROLLED_BACK);

    const actions = audits.map((a) => a.action);
    expect(actions).toContain(BatchAuditAction.LEG_ROLLED_BACK);
    expect(actions).toContain(BatchAuditAction.BATCH_ROLLED_BACK);
    // No compensating invocation for leg 0 was ever made.
    const invokeCalls = contractInvocation.invoke.mock.calls.map(
      (c: any[]) => c[0]?.contractId,
    );
    expect(invokeCalls.filter((c: string) => c === 'contract-0')).toHaveLength(
      1,
    );
  });

  it.todo(
    'rollbackLeg: submit an inverse transaction (or fail loudly if impossible), do not just flip status to ROLLED_BACK (issue #98)',
  );

  // KNOWN DEFECT (issue #98): persisted dependencies are stringly-typed
  // `order_N` placeholders, but buildGraphFromLegs matches them against
  // leg UUIDs — the lookup never matches, so dependents are scheduled in
  // arbitrary parallel layers and the prepare-time dependency check then
  // fails because completedLegs is only populated after a whole layer settles.
  it('documents the stringly-typed dependency defect: order_N deps produce one parallel layer', () => {
    const graph = new TransactionGraphBuilderService();
    const ordered = [makeLeg(0), makeLeg(1, { dependencies: ['order_0'] })];

    const built = graph.buildGraphFromLegs(ordered);

    // The edge order_0 -> leg-1 is dropped; both legs land in layer 0.
    expect(built.executionLayers).toEqual([[0, 1]]);
  });

  it('documents the runtime fallout: an order_N dependent leg fails preparation with "Dependencies not met"', async () => {
    const service = await build();
    legs.push(makeLeg(0), makeLeg(1, { dependencies: ['order_0'] }));
    const batch = makeBatch({ totalLegs: 2 });

    await expect(service.preparePhase(batch, legs)).rejects.toThrow(
      '1 legs failed during preparation',
    );

    expect(legs[1].status).toBe(LegStatus.FAILED);
    expect(legs[1].errorMessage).toBe('Dependencies not met');
  });

  it.todo(
    'buildGraphFromLegs: resolve order_N dependency placeholders to leg indices so dependents execute after their dependencies (issue #98)',
  );

  it('id-based dependencies are honoured by the graph builder', () => {
    const graph = new TransactionGraphBuilderService();
    const ordered = [makeLeg(0), makeLeg(1, { dependencies: ['leg-0'] })];

    const built = graph.buildGraphFromLegs(ordered);

    expect(built.executionLayers).toEqual([[0], [1]]);
    expect(built.topologicalOrder).toEqual([0, 1]);
  });

  // KNOWN DEFECT (issue #98): a price_lt condition on a leg whose price feed
  // returns nothing evaluates to true because currentPrice falls back to '0'.
  it('documents the missing-price defect: price_lt fires when the feed returns no price', async () => {
    const service = await build();
    const conditional = makeLeg(0, {
      isConditional: true,
      conditionType: 'price_lt',
      conditionExpression: '100',
    });
    legs.push(conditional);
    const batch = makeBatch({ totalLegs: 1, hasConditionals: true });

    contractInvocation.simulate
      .mockResolvedValueOnce({ result: {}, gas: { minResourceFee: '10' } }) // get_price: no price
      .mockResolvedValueOnce({
        result: { amount_out: '80' },
        gas: { minResourceFee: '10' }, // prepare simulation
      });

    await service.preparePhase(batch, legs);

    // Condition was treated as met (0 < 100); the leg proceeded to PREPARED.
    expect(conditional.status).toBe(LegStatus.PREPARED);
  });

  it.todo(
    'evaluateLegCondition: fail closed or skip when the price feed returns no price, do not default to 0 (issue #98)',
  );

  // KNOWN DEFECT (issue #98): a transient RPC error inside condition
  // evaluation is swallowed and reported as "condition not met", silently
  // SKIPPING a leg that may be economically safe to execute.
  it('documents the swallowed-error defect: RPC failure skips a conditional leg', async () => {
    const service = await build();
    const conditional = makeLeg(0, {
      isConditional: true,
      conditionType: 'price_lt',
      conditionExpression: '100',
    });
    legs.push(conditional);
    const batch = makeBatch({ totalLegs: 1, hasConditionals: true });

    contractInvocation.simulate.mockRejectedValueOnce(
      new Error('RPC unavailable'),
    );

    await service.preparePhase(batch, legs);

    expect(conditional.status).toBe(LegStatus.SKIPPED);
    expect(conditional.executionMetadata).toMatchObject({
      skipReason: 'condition_not_met',
    });
    expect(legs[0].status).toBe(LegStatus.SKIPPED);
  });

  it.todo(
    'evaluateLegCondition: distinguish "condition false" from "price feed unavailable" so transient RPC errors do not silently skip legs (issue #98)',
  );

  it('a conditional leg whose condition is false is skipped, and the batch still commits', async () => {
    const service = await build();
    const conditional = makeLeg(0, {
      isConditional: true,
      conditionType: 'price_lt',
      conditionExpression: '100',
    });
    legs.push(conditional);
    const batch = makeBatch({ totalLegs: 1, hasConditionals: true });

    contractInvocation.simulate.mockResolvedValueOnce({
      result: { price: '500' }, // 500 < 100 is false → skip
      gas: { minResourceFee: '10' },
    });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('committed');
    expect(result.skippedLegs).toBe(1);
    expect(result.committedLegs).toBe(0);
    expect(legs[0].status).toBe(LegStatus.SKIPPED);
  });

  it('a leg that fails during preparation fails the batch and rolls back', async () => {
    const service = await build();
    legs.push(makeLeg(0), makeLeg(1, { contractId: 'contract-boom' }));
    const batch = makeBatch({ status: BatchStatus.CREATED });

    contractInvocation.simulate.mockImplementation(async (req?: any) => {
      if (req?.contractId === 'contract-boom') {
        throw new Error('simulation reverted');
      }
      return { result: { amount_out: '80' }, gas: { minResourceFee: '10' } };
    });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('legs failed during preparation');
    expect(batch.status).toBe(BatchStatus.ROLLED_BACK);
    expect(
      audits.map((a) => a.action),
    ).toContain(BatchAuditAction.BATCH_ROLLBACK_STARTED);
  });

  it('pre-execution check failure aborts before any leg is prepared', async () => {
    const service = await build();
    // Negative amount trips the real pre-execution check.
    legs.push(makeLeg(0, { amount: '0' }), makeLeg(1));
    const batch = makeBatch({ status: BatchStatus.CREATED });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Pre-execution check failed');
    expect(legs.every((l) => l.status === LegStatus.PENDING)).toBe(true);
    expect(batch.status).toBe(BatchStatus.ROLLED_BACK);
  });

  it('batches with legs in a non-pending state fail the pre-execution check', async () => {
    const service = await build();
    legs.push(makeLeg(0, { status: LegStatus.EXECUTED }));
    const batch = makeBatch({ totalLegs: 1, status: BatchStatus.CREATED });

    const result = await service.executeBatch(batch);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Pre-execution check failed');
  });
});
