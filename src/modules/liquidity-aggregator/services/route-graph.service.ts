import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LiquidityPool,
  PoolStatus,
} from '../entities/liquidity-pool.entity';
import { RouteCache } from '../entities/route-cache.entity';

// ─── Graph types ──────────────────────────────────────────────────────────────

export interface GraphNode {
  assetCode: string;
  edges: GraphEdge[];
}

export interface GraphEdge {
  targetAsset: string;
  poolId: string;
  pool: LiquidityPool;
  /** Effective edge weight = fee rate + estimated slippage. */
  weight: number;
  /** TVL as a capacity indicator. */
  capacity: number;
}

export interface RouteResult {
  poolPath: string[];
  assetPath: string[];
  totalWeight: number;
  estimatedOutput: number;
  priceImpact: number;
  estimatedGas: number;
}

/**
 * Builds a directed graph of all swap paths between token pairs and finds
 * optimal routes using a modified Dijkstra's algorithm that considers
 * execution price impact, gas fees, slippage, and pool liquidity depth.
 */
@Injectable()
export class RouteGraphService {
  private readonly logger = new Logger(RouteGraphService.name);

  /** adjacency list: assetCode → outgoing edges */
  private graph = new Map<string, GraphNode>();
  /** Quick pool lookup by ID */
  private poolMap = new Map<string, LiquidityPool>();

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
    @InjectRepository(RouteCache)
    private readonly routeCacheRepository: Repository<RouteCache>,
  ) {}

  // ─── Graph construction ──────────────────────────────────────────────────

  /**
   * Rebuild the in-memory directed graph from all active pools.
   * Each AMM/order-book pool contributes two directed edges (A→B and B→A).
   */
  async buildGraph(): Promise<void> {
    const startTime = Date.now();
    this.graph.clear();
    this.poolMap.clear();

    const pools = await this.poolRepository.find({
      where: { status: PoolStatus.ACTIVE },
    });

    for (const pool of pools) {
      this.poolMap.set(pool.id, pool);
      this.addEdge(pool, pool.assetCodeA, pool.assetCodeB);
      this.addEdge(pool, pool.assetCodeB, pool.assetCodeA);
    }

    this.logger.log(
      `Built route graph with ${this.graph.size} nodes and ${pools.length * 2} edges in ${Date.now() - startTime}ms`,
    );
  }

  private addEdge(pool: LiquidityPool, from: string, to: string): {
    targetAsset: string;
    poolId: string;
    pool: LiquidityPool;
    weight: number;
    capacity: number;
  } {
    const tvl = parseFloat(pool.tvl);
    const feeRate = parseFloat(pool.feeRate);

    // Weight = fee rate + slippage estimate derived from TVL
    // Higher TVL → lower slippage → lower weight
    const slippageEstimate = tvl > 0 ? Math.min(0.05, 1000 / tvl) : 0.05;
    const weight = feeRate + slippageEstimate;

    const edge = {
      targetAsset: to,
      poolId: pool.id,
      pool,
      weight,
      capacity: tvl,
    };

    if (!this.graph.has(from)) {
      this.graph.set(from, { assetCode: from, edges: [] });
    }
    this.graph.get(from)!.edges.push(edge);

    return edge;
  }

  // ─── Path finding (modified Dijkstra) ────────────────────────────────────

  /**
   * Find the optimal route from tokenIn to tokenOut for a given input amount.
   * Uses a modified Dijkstra's algorithm where edge weights account for:
   * - Fee rates
   * - Price impact (simulated via constant-product AMM formula)
   * - Pool liquidity depth (capacity)
   *
   * @returns Top `topN` routes sorted by effective output.
   */
  async findOptimalRoutes(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    maxHops = 4,
    topN = 1,
  ): Promise<RouteResult[]> {
    if (this.graph.size === 0) {
      await this.buildGraph();
    }

    // Check cache first
    const cached = await this.getCachedRoute(tokenIn, tokenOut, amountIn);
    if (cached && topN === 1) {
      return [cached];
    }

    // Modified Dijkstra: find paths considering amount-dependent costs
    const candidates: RouteResult[] = [];
    this.dfs(
      tokenIn,
      tokenOut,
      amountIn,
      [],
      [],
      new Set(),
      0,
      maxHops,
      candidates,
    );

    // Sort by estimated output (descending)
    candidates.sort((a, b) => b.estimatedOutput - a.estimatedOutput);

    const results = candidates.slice(0, topN);

    // Cache the best route
    if (results.length > 0) {
      await this.cacheRoute(tokenIn, tokenOut, amountIn, results[0]);
    }

    return results;
  }

  /**
   * Depth-limited DFS to enumerate all feasible routes up to `maxHops`.
   * For each route, simulates the swap through each pool to compute the
   * true effective output accounting for price impact.
   */
  private dfs(
    current: string,
    target: string,
    currentAmount: number,
    poolPath: string[],
    assetPath: string[],
    visited: Set<string>,
    totalWeight: number,
    maxHops: number,
    results: RouteResult[],
  ): void {
    if (current === target && poolPath.length > 0) {
      const priceImpact = this.estimateRoutePriceImpact(poolPath, currentAmount);
      results.push({
        poolPath: [...poolPath],
        assetPath: [...assetPath, current],
        totalWeight,
        estimatedOutput: currentAmount,
        priceImpact,
        estimatedGas: poolPath.length * 100_000, // Base gas estimate per hop
      });
      return;
    }

    if (poolPath.length >= maxHops) return;

    const node = this.graph.get(current);
    if (!node) return;

    visited.add(current);

    for (const edge of node.edges) {
      if (visited.has(edge.targetAsset)) continue;

      // Simulate amount through this pool
      const outputAmount = this.simulateSwap(
        edge.pool,
        current,
        edge.targetAsset,
        currentAmount,
      );

      if (outputAmount <= 0) continue;

      this.dfs(
        edge.targetAsset,
        target,
        outputAmount,
        [...poolPath, edge.poolId],
        [...assetPath, current],
        visited,
        totalWeight + edge.weight,
        maxHops,
        results,
      );
    }

    visited.delete(current);
  }

  /**
   * Simulate a swap through a single pool using the constant-product AMM
   * formula: amountOut = (amountIn * reserveOut * (1 - fee)) /
   *                        (reserveIn + amountIn * (1 - fee))
   */
  private simulateSwap(
    pool: LiquidityPool,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): number {
    const tvl = parseFloat(pool.tvl);
    const feeRate = parseFloat(pool.feeRate);

    if (tvl <= 0) return 0;

    // Approximate reserves from TVL (50/50 split for AMMs)
    const halfTvl = tvl / 2;
    const reserveIn = halfTvl;
    const reserveOut = halfTvl;

    const amountInWithFee = amountIn * (1 - feeRate);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;

    return denominator > 0 ? numerator / denominator : 0;
  }

  /**
   * Estimate the price impact of executing a route with the given input.
   * Price impact = (marketPrice - executionPrice) / marketPrice
   */
  private estimateRoutePriceImpact(
    poolPath: string[],
    amountIn: number,
  ): number {
    // Sum of individual pool price impacts along the route
    let cumulativeImpact = 0;

    let currentAmount = amountIn;
    for (const poolId of poolPath) {
      const pool = this.poolMap.get(poolId);
      if (!pool) continue;

      const tvl = parseFloat(pool.tvl);
      if (tvl <= 0) continue;

      // Price impact ≈ amountIn / pool_liquidity
      const impact = Math.min(currentAmount / (tvl / 2), 1);
      cumulativeImpact += impact * (1 - cumulativeImpact);
      currentAmount = currentAmount * (1 - impact);
    }

    return cumulativeImpact;
  }

  // ─── Route cache ─────────────────────────────────────────────────────────

  private async getCachedRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): Promise<RouteResult | null> {
    const cached = await this.routeCacheRepository.findOne({
      where: { tokenIn, tokenOut },
      order: { createdAt: 'DESC' },
    });

    if (!cached || cached.expiresAt < new Date()) return null;

    return {
      poolPath: cached.poolPath,
      assetPath: [tokenIn, ...cached.poolPath.map(() => ''), tokenOut],
      totalWeight: 0,
      estimatedOutput: parseFloat(cached.expectedOutput),
      priceImpact: parseFloat(cached.priceImpact),
      estimatedGas: parseFloat(cached.estimatedGas),
    };
  }

  private async cacheRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    result: RouteResult,
  ): Promise<void> {
    const ttlMs = 30_000; // 30 second TTL for route cache
    await this.routeCacheRepository.save(
      this.routeCacheRepository.create({
        tokenIn,
        tokenOut,
        poolPath: result.poolPath,
        expectedOutput: result.estimatedOutput.toString(),
        priceImpact: result.priceImpact.toString(),
        estimatedGas: result.estimatedGas.toString(),
        confidence: Math.max(0, 1 - result.priceImpact).toFixed(4),
        expiresAt: new Date(Date.now() + ttlMs),
      }),
    );
  }

  /**
   * Invalidate stale cache entries. Called periodically by the monitoring service.
   */
  async pruneExpiredCache(): Promise<number> {
    const result = await this.routeCacheRepository
      .createQueryBuilder()
      .delete()
      .where('expiresAt < NOW()')
      .execute();
    return result.affected ?? 0;
  }
}
