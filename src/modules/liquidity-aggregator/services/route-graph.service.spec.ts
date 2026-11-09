import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RouteGraphService } from './route-graph.service';
import {
  LiquidityPool,
  PoolStatus,
  PoolType,
} from '../entities/liquidity-pool.entity';
import { RouteCache } from '../entities/route-cache.entity';

/**
 * Unit tests for RouteGraphService (issue #97).
 *
 * Hermetic: repositories are hand-written in-memory fakes; no network or
 * database. Fixtures use fixed timestamps — no wall-clock dependence.
 *
 * FIXED DEFECTS referenced from the issue tracker (issue #97):
 * - `getCachedRoute()` previously ignored `amountIn`, serving a route priced
 *   for a 100-unit swap to a 1,000,000-unit order. The cache is now
 *   amount-scoped (`amountIn` column + migration); the regression tests
 *   below pin that behaviour.
 * - `getCachedRoute()` returned an `assetPath` of literal empty strings.
 *   The path is now rebuilt from the pool path via the in-memory graph.
 */

const FUTURE = new Date('2999-01-01T00:00:00.000Z');
const PAST = new Date('2020-01-01T00:00:00.000Z');

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
    lastRefreshedAt: new Date('2026-01-01T00:00:00.000Z'),
    config: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as LiquidityPool;
}

function makeCachedRoute(over: Partial<RouteCache> = {}): RouteCache {
  return {
    id: 'cache-1',
    tokenIn: 'XLM',
    tokenOut: 'USDC',
    amountIn: '100',
    poolPath: ['pool-1'],
    expectedOutput: '42',
    priceImpact: '0.01',
    estimatedGas: '100000',
    confidence: '0.99',
    expiresAt: FUTURE,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as RouteCache;
}

describe('RouteGraphService (issue #97)', () => {
  let poolFind: jest.Mock;
  let cacheFindOne: jest.Mock;
  let cacheSave: jest.Mock;
  let cacheCreate: jest.Mock;
  let cacheDeleteChain: { where: jest.Mock; execute: jest.Mock };

  async function build(
    pools: LiquidityPool[],
    cacheRow: RouteCache | null = null,
  ): Promise<RouteGraphService> {
    poolFind = jest.fn(async () => pools);
    cacheFindOne = jest.fn(async ({ where }: any) => {
      if (!cacheRow) return undefined;
      if (cacheRow.expiresAt < new Date()) return undefined;
      if (
        where?.tokenIn === cacheRow.tokenIn &&
        where?.tokenOut === cacheRow.tokenOut &&
        where?.amountIn === cacheRow.amountIn
      ) {
        return cacheRow;
      }
      return undefined;
    });
    cacheCreate = jest.fn((data: any) => data);
    cacheSave = jest.fn(async (row: any) => row);
    cacheDeleteChain = {
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => ({ affected: 3 })),
    };

    const routeCacheRepository = {
      findOne: cacheFindOne,
      create: cacheCreate,
      save: cacheSave,
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnValue(cacheDeleteChain),
      })),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RouteGraphService,
        {
          provide: getRepositoryToken(LiquidityPool),
          useValue: { find: poolFind },
        },
        {
          provide: getRepositoryToken(RouteCache),
          useValue: routeCacheRepository,
        },
      ],
    }).compile();

    return moduleRef.get(RouteGraphService);
  }

  it('buildGraph registers both directions of every pool as edges', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
      makePool({ id: 'pool-2', assetCodeA: 'USDC', assetCodeB: 'EUR' }),
    ];
    const service = await build(pools);

    await service.buildGraph();

    const graph: Map<string, { assetCode: string; edges: any[] }> =
      (service as any).graph;
    expect([...graph.keys()].sort()).toEqual(['EUR', 'USDC', 'XLM']);
    // Each pool contributes one edge in each direction.
    expect(graph.get('XLM')!.edges).toHaveLength(1);
    expect(graph.get('USDC')!.edges).toHaveLength(2);
    expect(graph.get('EUR')!.edges).toHaveLength(1);
  });

  it('edge weight is fee rate plus the TVL-based slippage estimate', async () => {
    const pools = [
      makePool({ id: 'pool-1', tvl: '1000000', feeRate: '0.003' }),
    ];
    const service = await build(pools);

    await service.buildGraph();

    const edges = (service as any).graph.get('XLM').edges;
    const edge = edges.find((e: any) => e.targetAsset === 'USDC');
    // slippage = min(0.05, 1000/1e6) = 0.001 → weight = 0.004
    expect(edge.weight).toBeCloseTo(0.004, 6);
    expect(edge.capacity).toBe(1000000);
    expect(edge.poolId).toBe('pool-1');
  });

  it('finds a direct route between two paired assets', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    const service = await build(pools);

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 100);

    expect(routes).toHaveLength(1);
    expect(routes[0].assetPath).toEqual(['XLM', 'USDC']);
    expect(routes[0].poolPath).toEqual(['pool-1']);
    expect(routes[0].estimatedOutput).toBeGreaterThan(0);
    expect(routes[0].estimatedGas).toBe(100000);
    expect(routes[0].priceImpact).toBeGreaterThanOrEqual(0);
  });

  it('finds a multi-hop route through an intermediate asset', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
      makePool({ id: 'pool-2', assetCodeA: 'USDC', assetCodeB: 'EUR' }),
    ];
    const service = await build(pools);

    const routes = await service.findOptimalRoutes('XLM', 'EUR', 10, 2);

    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(routes[0].assetPath).toEqual(['XLM', 'USDC', 'EUR']);
    expect(routes[0].poolPath).toEqual(['pool-1', 'pool-2']);
    expect(routes[0].estimatedGas).toBe(200000);
  });

  it('respects the maxHops limit', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
      makePool({ id: 'pool-2', assetCodeA: 'USDC', assetCodeB: 'EUR' }),
    ];
    const service = await build(pools);

    const routes = await service.findOptimalRoutes('XLM', 'EUR', 10, 1);

    // The only XLM→EUR path needs two hops and must be rejected.
    expect(routes).toEqual([]);
  });

  it('never repeats an asset within a route path', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
      makePool({ id: 'pool-2', assetCodeA: 'USDC', assetCodeB: 'EUR' }),
      makePool({ id: 'pool-3', assetCodeA: 'EUR', assetCodeB: 'XLM' }),
    ];
    const service = await build(pools);

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 10, 4, 5);

    expect(routes.length).toBeGreaterThanOrEqual(1);
    for (const route of routes) {
      expect(new Set(route.assetPath).size).toBe(route.assetPath.length);
    }
  });

  it('cache regression (issue #97): a cached route priced for a different amountIn is NOT served', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    // Cached route priced for a 100-unit swap; expectedOutput would be
    // wildly wrong for a 1,000,000-unit order.
    const cached = makeCachedRoute({ amountIn: '100' });
    const service = await build(pools, cached);

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 1000000);

    // Cache lookup must have been scoped to the requested amount…
    expect(cacheFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ amountIn: '1000000' }),
      }),
    );
    // …and missed, so the route is recomputed rather than serving 42.
    expect(routes).toHaveLength(1);
    expect(routes[0].estimatedOutput).toBeGreaterThan(1000);
    expect(routes[0].estimatedOutput).not.toBe(42);
  });

  it('cache hit for the same amountIn serves the cached output and a rebuilt assetPath', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    const cached = makeCachedRoute({ amountIn: '100' });
    const service = await build(pools, cached);
    await service.buildGraph();

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 100);

    expect(routes).toHaveLength(1);
    expect(routes[0].estimatedOutput).toBe(42);
    // No literal empty strings — path reconstructed from the pool path.
    expect(routes[0].assetPath).toEqual(['XLM', 'USDC']);
    expect(routes[0].assetPath).not.toContain('');
    expect(routes[0].poolPath).toEqual(['pool-1']);
  });

  it('expired cache entries are ignored and the route is recomputed', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    const cached = makeCachedRoute({ amountIn: '100', expiresAt: PAST });
    const service = await build(pools, cached);

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 100);

    expect(routes).toHaveLength(1);
    expect(routes[0].estimatedOutput).toBeGreaterThan(1);
    expect(routes[0].estimatedOutput).not.toBe(42);
  });

  it('cache miss persists the new route together with its amountIn', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    const service = await build(pools, null);

    await service.findOptimalRoutes('XLM', 'USDC', 1000);

    expect(cacheSave).toHaveBeenCalledTimes(1);
    expect(cacheCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenIn: 'XLM',
        tokenOut: 'USDC',
        amountIn: '1000',
        poolPath: ['pool-1'],
      }),
    );
  });

  it('treats a cached route whose pool vanished from the graph as stale', async () => {
    const pools = [
      makePool({ id: 'pool-1', assetCodeA: 'XLM', assetCodeB: 'USDC' }),
    ];
    const cached = makeCachedRoute({
      amountIn: '100',
      poolPath: ['pool-gone'],
    });
    const service = await build(pools, cached);

    const routes = await service.findOptimalRoutes('XLM', 'USDC', 100);

    expect(routes).toHaveLength(1);
    expect(routes[0].assetPath).toEqual(['XLM', 'USDC']);
    expect(routes[0].estimatedOutput).not.toBe(42);
  });

  it('pruneExpiredCache issues a delete and returns the affected row count', async () => {
    const service = await build([]);

    const affected = await service.pruneExpiredCache();

    expect(affected).toBe(3);
    expect(cacheDeleteChain.execute).toHaveBeenCalledTimes(1);
  });
});
