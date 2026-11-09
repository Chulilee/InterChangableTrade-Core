import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PriceImpactService } from './price-impact.service';
import {
  LiquidityPool,
  PoolStatus,
  PoolType,
} from '../entities/liquidity-pool.entity';

/**
 * Unit tests for PriceImpactService (issue #97).
 *
 * Hermetic: the TypeORM pool repository is replaced with a hand-written
 * in-memory fake; there is no network or database dependency. Fixtures use
 * fixed values — no wall-clock time, no randomness.
 *
 * KNOWN DEFECT (issue #97): `calculatePoolImpact()` derives reserves as
 * `tvl / 2` for both sides, so `marketPrice` is always exactly 1 regardless
 * of the pool's real reserve ratio or fee. The tests below document the
 * current arithmetic; the fix is tracked with `it.todo`.
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

describe('PriceImpactService (issue #97)', () => {
  let service: PriceImpactService;
  let poolFind: jest.Mock;
  let poolFindOne: jest.Mock;

  async function build(pools: LiquidityPool[]): Promise<PriceImpactService> {
    poolFind = jest.fn(async () => pools);
    poolFindOne = jest.fn(
      async ({ where: { id } }: any) =>
        pools.find((p) => p.id === id) ?? null,
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PriceImpactService,
        {
          provide: getRepositoryToken(LiquidityPool),
          useValue: { find: poolFind, findOne: poolFindOne },
        },
      ],
    }).compile();

    return moduleRef.get(PriceImpactService);
  }

  it('computes the constant-product output for a swap', async () => {
    const pool = makePool({ tvl: '2000000', feeRate: '0.003' });
    service = await build([pool]);

    const { results } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
    );

    expect(results).toHaveLength(1);
    // reserves are approximated as tvl/2 = 1,000,000 each
    // out = (1000 * 0.997 * 1e6) / (1e6 + 1000 * 0.997)
    expect(results[0].outputAmount).toBeCloseTo(996.007, 3);
    expect(results[0].inputAmount).toBe(1000);
    expect(results[0].estimatedSlippage).toBeCloseTo(0.1, 6);
  });

  it('reports a small, positive price impact for a small trade', async () => {
    const pool = makePool({ tvl: '2000000', feeRate: '0.003' });
    service = await build([pool]);

    const { results } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
    );

    expect(results[0].priceImpactPercent).toBeGreaterThan(0);
    expect(results[0].priceImpactPercent).toBeLessThan(1);
    expect(results[0].isFeasible).toBe(true);
  });

  it('flags a very large trade as infeasible (impact >= 5%)', async () => {
    const pool = makePool({ tvl: '2000000', feeRate: '0.003' });
    service = await build([pool]);

    const { results } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      200000,
    );

    expect(results[0].priceImpactPercent).toBeGreaterThan(5);
    expect(results[0].isFeasible).toBe(false);
  });

  it('findMaxInputForImpact returns a bound whose own impact is below threshold', async () => {
    service = await build([]);

    const reserveIn = 1e6;
    const reserveOut = 1e6;
    const feeRate = 0.003;
    const maxInput = (service as any).findMaxInputForImpact(
      reserveIn,
      reserveOut,
      feeRate,
      0.05,
    );

    expect(maxInput).toBeGreaterThan(0);
    expect(
      (service as any).computeImpact(reserveIn, reserveOut, feeRate, maxInput),
    ).toBeLessThan(0.05);
    // One thousand units past the bound breaks the 5% budget.
    expect(
      (service as any).computeImpact(
        reserveIn,
        reserveOut,
        feeRate,
        maxInput + 1000,
      ),
    ).toBeGreaterThanOrEqual(0.05);
    expect(Number.isInteger(maxInput)).toBe(true);
  });

  it('surfaces a zero-TVL pool as infeasible with zero output', async () => {
    const pool = makePool({ tvl: '0', volume24h: '0' });
    service = await build([pool]);

    const { results, bestPool } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0].outputAmount).toBe(0);
    expect(results[0].isFeasible).toBe(false);
    expect(results[0].priceImpactPercent).toBe(100);
    expect(results[0].maxInputBeforeHighImpact).toBe(0);
    expect(bestPool).toBeNull();
  });

  it('scopes the estimate to a single pool when poolId is provided', async () => {
    const pools = [
      makePool({ id: 'pool-a', name: 'A', tvl: '2000000' }),
      makePool({ id: 'pool-b', name: 'B', tvl: '4000000' }),
    ];
    service = await build(pools);

    const { results } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
      'pool-b',
    );

    expect(poolFind).not.toHaveBeenCalled();
    expect(poolFindOne).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.poolId)).toEqual(['pool-b']);
  });

  it('returns empty results when the requested poolId does not exist', async () => {
    service = await build([makePool({ id: 'pool-a' })]);

    const { results, bestPool } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
      'missing-pool',
    );

    expect(results).toEqual([]);
    expect(bestPool).toBeNull();
  });

  it('selects the deepest pool as bestPool for a large trade', async () => {
    const shallow = makePool({ id: 'pool-a', name: 'A', tvl: '2000000' });
    const deep = makePool({ id: 'pool-b', name: 'B', tvl: '4000000' });
    service = await build([shallow, deep]);

    const { bestPool } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      100000,
    );

    expect(bestPool?.poolId).toBe('pool-b');
  });

  // KNOWN DEFECT (issue #97): reserves are approximated as tvl/2, so the
  // ratio — and therefore this price — is always exactly 1. A real market
  // price would reflect the actual reserve imbalance.
  it('documents the tvl/2 market-price defect: marketPrice is always 1', async () => {
    const pool = makePool({ tvl: '2000000', feeRate: '0.003' });
    service = await build([pool]);

    const { results } = await service.estimatePriceImpact(
      'XLM',
      null,
      'USDC',
      null,
      1000,
    );

    expect(results[0].marketPrice).toBe(1);
  });

  it.todo(
    'price-impact: derive marketPrice from actual pool reserves, not tvl/2 (issue #97)',
  );
});
