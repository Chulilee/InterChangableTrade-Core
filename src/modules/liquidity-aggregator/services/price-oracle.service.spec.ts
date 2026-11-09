import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PriceOracleService } from './price-oracle.service';
import {
  LiquidityPool,
  PoolStatus,
  PoolType,
} from '../entities/liquidity-pool.entity';
import { PoolSnapshot } from '../entities/pool-snapshot.entity';

/**
 * Unit tests for PriceOracleService (issue #97).
 *
 * Hermetic: repositories faked in-memory; fixed timestamps; no randomness.
 *
 * KNOWN DEFECTS (issue #97), documented by the pinning tests below:
 * - `getAggregatedPrice()` keeps the HIGHEST pool price as `bestPrice`,
 *   while the interface documents "lowest for buy".
 * - `getTWAP()` anchors each interval to `prices[i - 1]` starting at index 1
 *   and divides by `t[last] - t[0]`, so the window boundary before the first
 *   snapshot and the final price carry no weight.
 */

const T0 = new Date('2026-06-01T00:00:00.000Z');
const T1 = new Date('2026-06-01T00:10:00.000Z');
const T2 = new Date('2026-06-01T00:20:00.000Z');

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
    tvl: over.tvl ?? '1000000',
    feeRate: over.feeRate ?? '0.003',
    volume24h: over.volume24h ?? '500000',
    feeRevenue24h: '0',
    maxInputSize: null,
    onChainAddress: null,
    lastRefreshedAt: T2,
    config: null,
    createdAt: T0,
    updatedAt: T2,
    ...over,
  } as LiquidityPool;
}

describe('PriceOracleService (issue #97)', () => {
  let poolFind: jest.Mock;
  let snapshotGetMany: jest.Mock;

  async function build(
    pools: LiquidityPool[],
    snapshots: Array<Partial<PoolSnapshot>> = [],
  ): Promise<PriceOracleService> {
    poolFind = jest.fn(async () => pools);
    snapshotGetMany = jest.fn(async () =>
      snapshots.map(
        (s) =>
          ({
            id: s.id ?? 'snap',
            poolId: s.poolId ?? 'pool-1',
            snapshotAt: s.snapshotAt ?? T0,
            spotPrice: s.spotPrice ?? '1',
            volume24h: s.volume24h ?? '0',
            createdAt: T0,
            updatedAt: T0,
          }) as PoolSnapshot,
      ),
    );

    const snapshotRepository = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: snapshotGetMany,
      })),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PriceOracleService,
        {
          provide: getRepositoryToken(LiquidityPool),
          useValue: { find: poolFind },
        },
        {
          provide: getRepositoryToken(PoolSnapshot),
          useValue: snapshotRepository,
        },
      ],
    }).compile();

    return moduleRef.get(PriceOracleService);
  }

  it('returns zeros and epoch lastUpdated when no pool exists for the pair', async () => {
    const service = await build([]);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    expect(price).toEqual({
      tokenIn: 'XLM',
      tokenOut: 'USDC',
      weightedPrice: 0,
      simplePrice: 0,
      poolCount: 0,
      totalTvl: 0,
      bestPrice: 0,
      lastUpdated: new Date(0),
    });
  });

  it('computes the volume-weighted price across direct-orientation pools', async () => {
    // price = (volume / tvl) * (1 - feeRate), identical direction for both.
    const pools = [
      makePool({ id: 'pool-a', tvl: '1000000', volume24h: '1000000', feeRate: '0' }), // price 1.0
      makePool({ id: 'pool-b', tvl: '1000000', volume24h: '3000000', feeRate: '0' }), // price 3.0
    ];
    const service = await build(pools);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    // weighted = (1*1e6 + 3*3e6) / (1e6 + 3e6) = 2.5
    expect(price.weightedPrice).toBeCloseTo(2.5, 6);
    // simple = (1 + 3) / 2 = 2
    expect(price.simplePrice).toBeCloseTo(2, 6);
    expect(price.poolCount).toBe(2);
    expect(price.totalTvl).toBeCloseTo(2000000, 6);
  });

  it('inverts the price for pools storing the pair in reverse', async () => {
    // Inverse pool: rawPrice = volume/tvl = 2 → adjusted = 1/2 * (1-0) = 0.5
    const inverse = makePool({
      id: 'pool-inv',
      assetCodeA: 'USDC',
      assetCodeB: 'XLM',
      tvl: '1000000',
      volume24h: '2000000',
      feeRate: '0',
    });
    const service = await build([inverse]);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    expect(price.weightedPrice).toBeCloseTo(0.5, 6);
    expect(price.simplePrice).toBeCloseTo(0.5, 6);
  });

  it('excludes zero-volume pools from the volume-weighted average', async () => {
    const pools = [
      makePool({ id: 'pool-a', tvl: '1000000', volume24h: '1000000', feeRate: '0' }), // price 1, volume 1e6
      makePool({ id: 'pool-b', tvl: '1000000', volume24h: '0', feeRate: '0' }), // price 0 → excluded
    ];
    const service = await build(pools);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    expect(price.weightedPrice).toBeCloseTo(1, 6);
  });

  it('uses the pool with the freshest lastRefreshedAt as lastUpdated', async () => {
    const older = makePool({ id: 'pool-old', lastRefreshedAt: T0 });
    const newer = makePool({ id: 'pool-new', lastRefreshedAt: T2 });
    const service = await build([older, newer]);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    expect(price.lastUpdated).toEqual(T2);
  });

  // KNOWN DEFECT (issue #97): the interface documents bestPrice as
  // "lowest for buy" but the implementation keeps the highest price.
  it('documents the bestPrice direction defect: code tracks the maximum', async () => {
    const pools = [
      makePool({ id: 'pool-a', tvl: '1000000', volume24h: '1000000', feeRate: '0' }), // price 1
      makePool({ id: 'pool-b', tvl: '1000000', volume24h: '2000000', feeRate: '0' }), // price 2
    ];
    const service = await build(pools);

    const price = await service.getAggregatedPrice('XLM', null, 'USDC', null);

    expect(price.bestPrice).toBeCloseTo(2, 6);
  });

  it.todo(
    'price-oracle: bestPrice should track the lowest price for buys (issue #97)',
  );

  it('getBatchPrices returns one entry per requested pair', async () => {
    const service = await build([makePool({ feeRate: '0' })]);

    const prices = await service.getBatchPrices([
      { tokenIn: 'XLM', tokenOut: 'USDC' },
      { tokenIn: 'XLM', tokenOut: 'EUR' },
    ]);

    expect(prices).toHaveLength(2);
    expect(prices.map((p) => p.tokenIn)).toEqual(['XLM', 'XLM']);
  });

  it('getHistoricalPrices maps snapshot rows to price points in ascending order', async () => {
    const service = await build([], [
      { snapshotAt: T0, spotPrice: '1.1', volume24h: '100' },
      { snapshotAt: T1, spotPrice: '1.2', volume24h: '200' },
    ]);

    const points = await service.getHistoricalPrices('pool-1', T0, T2);

    expect(points).toEqual([
      { timestamp: T0, price: 1.1, volume: 100 },
      { timestamp: T1, price: 1.2, volume: 200 },
    ]);
  });

  it('getTWAP returns 0 when there is no price history', async () => {
    const service = await build([], []);
    expect(await service.getTWAP('pool-1', 30)).toBe(0);
  });

  it('getTWAP returns 0 for a single snapshot (no interval to weight)', async () => {
    const service = await build([], [
      { snapshotAt: T0, spotPrice: '1.5', volume24h: '100' },
    ]);
    expect(await service.getTWAP('pool-1', 30)).toBe(0);
  });

  // KNOWN DEFECT (issue #97): getTWAP weights `prices[i - 1]` for
  // i in [1, n) and divides by (t[n-1] - t[0]). The boundary before the
  // first snapshot and the final price carry no weight — i.e. the leading
  // interval is effectively dropped once you compare against a
  // boundary-anchored TWAP. The test pins the current arithmetic:
  // twap = (100 * 600 + 110 * 600) / 1200 = 105.
  it('documents the leading-interval defect in getTWAP weighting', async () => {
    const service = await build([], [
      { snapshotAt: T0, spotPrice: '100', volume24h: '100' },
      { snapshotAt: T1, spotPrice: '110', volume24h: '100' },
      { snapshotAt: T2, spotPrice: '130', volume24h: '100' },
    ]);

    const twap = await service.getTWAP('pool-1', 30);

    expect(twap).toBeCloseTo(105, 6);
  });

  it.todo(
    'price-oracle: anchor the TWAP window to the requested from boundary so the leading interval is weighted (issue #97)',
  );
});
