import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MultiRouteSplitterService } from './multi-route-splitter.service';
import {
  LiquidityPool,
  PoolStatus,
  PoolType,
} from '../entities/liquidity-pool.entity';

/**
 * Unit tests for MultiRouteSplitterService (issue #97).
 *
 * Hermetic: the TypeORM pool repository is faked in-memory; no network or
 * database. Fixtures use fixed values — no wall-clock time, no randomness.
 *
 * KNOWN DEFECT (issue #97): `greedyAllocate()` computes
 * `STEP_SIZE = totalAmount / 100`, so `amountIn = 0` (which `@Min(0)`
 * permits) yields `STEP_SIZE = 0` and `steps = Math.ceil(0 / 0) = NaN`.
 * The loop terminates only because `remaining > 0` is false; the function
 * happens to return an empty allocation, which still looks like a valid
 * result to a caller that never checked `allocations.length`. The tests
 * below pin the current behaviour and record the hazard.
 */

function makePool(over: Partial<LiquidityPool> = {}): LiquidityPool {
  return {
    id: over.id ?? 'pool-1',
    name: over.name ?? 'Test Pool',
    type: PoolType.AMM,
    status: PoolStatus.ACTIVE,
    assetCodeA: over.assetCodeA ?? 'XLM',
    assetIssuerA: over.assetIssuerA ?? null,
    assetCodeB: over.assetCodeB ?? 'USDC',
    assetIssuerB: over.assetIssuerB ?? null,
    tvl: over.tvl ?? '2000000',
    feeRate: over.feeRate ?? '0.003',
    volume24h: over.volume24h ?? '500000',
    feeRevenue24h: '0',
    maxInputSize: null,
    onChainAddress: null,
    lastRefreshedAt: new Date('2026-01-01T00:00:00.000Z'),
    config: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as LiquidityPool;
}

describe('MultiRouteSplitterService (issue #97)', () => {
  async function build(
    pools: LiquidityPool[],
  ): Promise<MultiRouteSplitterService> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MultiRouteSplitterService,
        {
          provide: getRepositoryToken(LiquidityPool),
          useValue: { find: jest.fn(async () => pools) },
        },
      ],
    }).compile();

    return moduleRef.get(MultiRouteSplitterService);
  }

  it('constantProductOutput matches the AMM formula with fees', async () => {
    const service = await build([]);
    const out = (service as any).constantProductOutput(1000, 1000, 0.003, 10);
    // (10 * 0.997 * 1000) / (1000 + 10 * 0.997)
    expect(out).toBeCloseTo(9.872, 3);
    expect((service as any).constantProductOutput(1000, 1000, 0.003, 0)).toBe(0);
  });

  it('allocates the full input across pools (sum invariant)', async () => {
    const pools = [
      makePool({ id: 'pool-a', name: 'A', tvl: '2000000' }),
      makePool({ id: 'pool-b', name: 'B', tvl: '2000000' }),
    ];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      10000,
      2,
    );

    const allocated = result.allocations.reduce((s, a) => s + a.amountIn, 0);
    expect(allocated).toBeCloseTo(10000, 6);

    const fractionSum = result.allocations.reduce((s, a) => s + a.fraction, 0);
    expect(fractionSum).toBeCloseTo(1, 6);

    const outputSum = result.allocations.reduce(
      (s, a) => s + a.expectedOutput,
      0,
    );
    expect(outputSum).toBeCloseTo(result.totalExpectedOutput, 6);

    for (const allocation of result.allocations) {
      expect(allocation.amountIn).toBeLessThanOrEqual(10000);
      expect(allocation.expectedOutput).toBeGreaterThan(0);
      expect(allocation.fraction).toBeGreaterThan(0);
    }

    // Allocations are sorted by descending amount.
    const amounts = result.allocations.map((a) => a.amountIn);
    expect([...amounts].sort((x, y) => y - x)).toEqual(amounts);
  });

  it('splits across two identical pools for a large trade', async () => {
    const pools = [
      makePool({ id: 'pool-a', name: 'A', tvl: '2000000' }),
      makePool({ id: 'pool-b', name: 'B', tvl: '2000000' }),
    ];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      100000,
      2,
    );

    expect(result.splitCount).toBe(2);
    expect(result.allocations).toHaveLength(2);
    // Both pools are used; neither takes the whole amount.
    for (const allocation of result.allocations) {
      expect(allocation.amountIn).toBeGreaterThan(0);
      expect(allocation.amountIn).toBeLessThan(100000);
    }
    // Splitting beats single-pool execution for a large trade.
    expect(result.improvementOverSingle).toBeGreaterThan(0);
    expect(result.blendedPrice).toBeGreaterThan(0);
  });

  it('routes everything through the only pool with liquidity', async () => {
    const pools = [
      makePool({ id: 'pool-dead', name: 'Dead', tvl: '0', volume24h: '0' }),
      makePool({ id: 'pool-live', name: 'Live', tvl: '2000000' }),
    ];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      5000,
      2,
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].poolId).toBe('pool-live');
    expect(result.allocations[0].amountIn).toBeCloseTo(5000, 6);
  });

  it('uses at most numSplits pools', async () => {
    const pools = [
      makePool({ id: 'pool-a', name: 'A', tvl: '2000000' }),
      makePool({ id: 'pool-b', name: 'B', tvl: '2000000' }),
      makePool({ id: 'pool-c', name: 'C', tvl: '2000000' }),
    ];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      10000,
      2,
    );

    expect(result.splitCount).toBeLessThanOrEqual(2);
    expect(result.allocations.length).toBeLessThanOrEqual(2);
  });

  it('returns a sane empty result when amountIn is 0 (no NaN leaks)', async () => {
    const pools = [makePool({ id: 'pool-a', name: 'A' })];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      0,
      2,
    );

    // KNOWN DEFECT (issue #97): STEP_SIZE = 0/100 = 0 and steps = NaN;
    // the loop exits only because remaining is 0. The empty allocation set
    // is indistinguishable from "no route" for callers that do not check
    // splitCount — this test pins the current behaviour.
    expect(result.allocations).toEqual([]);
    expect(result.splitCount).toBe(0);
    expect(Number.isNaN(result.totalExpectedOutput)).toBe(false);
    expect(Number.isNaN(result.blendedPrice)).toBe(false);
    expect(Number.isNaN(result.improvementOverSingle)).toBe(false);
    expect(result.totalExpectedOutput).toBe(0);
  });

  it('returns an empty result when no pool exists for the pair', async () => {
    const service = await build([]);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      10000,
      2,
    );

    expect(result.allocations).toEqual([]);
    expect(result.splitCount).toBe(0);
    expect(result.totalExpectedOutput).toBe(0);
    expect(result.blendedPrice).toBe(0);
  });

  it('every allocation has finite, non-negative numeric fields', async () => {
    const pools = [
      makePool({ id: 'pool-a', name: 'A', tvl: '1500000' }),
      makePool({ id: 'pool-b', name: 'B', tvl: '3000000' }),
    ];
    const service = await build(pools);

    const result = await service.findOptimalSplit(
      'XLM',
      null,
      'USDC',
      null,
      25000,
      2,
    );

    for (const allocation of result.allocations) {
      expect(Number.isFinite(allocation.amountIn)).toBe(true);
      expect(Number.isFinite(allocation.expectedOutput)).toBe(true);
      expect(Number.isFinite(allocation.priceImpact)).toBe(true);
      expect(Number.isFinite(allocation.fraction)).toBe(true);
      expect(allocation.amountIn).toBeGreaterThanOrEqual(0);
      expect(allocation.priceImpact).toBeGreaterThanOrEqual(0);
    }
  });
});
