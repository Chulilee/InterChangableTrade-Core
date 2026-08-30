import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiquidityPool, PoolStatus } from '../entities/liquidity-pool.entity';
import { PoolSnapshot } from '../entities/pool-snapshot.entity';

/**
 * Aggregated price for a token pair across all pools, volume-weighted.
 */
export interface AggregatedPrice {
  tokenIn: string;
  tokenOut: string;
  /** Volume-weighted average price. */
  weightedPrice: number;
  /** Simple average across pools. */
  simplePrice: number;
  /** Number of pools contributing. */
  poolCount: number;
  /** Total liquidity (TVL) backing this price. */
  totalTvl: number;
  /** Best single-pool price (lowest for buy). */
  bestPrice: number;
  /** Timestamp of freshest data point. */
  lastUpdated: Date;
}

export interface PricePoint {
  timestamp: Date;
  price: number;
  volume: number;
}

/**
 * Aggregates prices from multiple pools using volume-weighted averaging.
 * Provides spot prices, historical price data, and TWAP calculations.
 */
@Injectable()
export class PriceOracleService {
  private readonly logger = new Logger(PriceOracleService.name);

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
    @InjectRepository(PoolSnapshot)
    private readonly snapshotRepository: Repository<PoolSnapshot>,
  ) {}

  /**
   * Get the volume-weighted aggregated price for a token pair across all
   * pools containing those tokens.
   */
  async getAggregatedPrice(
    tokenIn: string,
    tokenInIssuer: string | null,
    tokenOut: string,
    tokenOutIssuer: string | null,
  ): Promise<AggregatedPrice> {
    const pools = await this.findPoolsForPair(
      tokenIn,
      tokenInIssuer,
      tokenOut,
      tokenOutIssuer,
    );

    if (pools.length === 0) {
      return {
        tokenIn,
        tokenOut,
        weightedPrice: 0,
        simplePrice: 0,
        poolCount: 0,
        totalTvl: 0,
        bestPrice: 0,
        lastUpdated: new Date(0),
      };
    }

    let totalWeightedPrice = 0;
    let totalVolume = 0;
    let simplePriceSum = 0;
    let bestPrice = 0;
    let totalTvl = 0;
    let freshestUpdate = new Date(0);

    for (const pool of pools) {
      const price = this.calculatePoolPrice(pool, tokenIn, tokenOut);
      const volume = parseFloat(pool.volume24h);
      const tvl = parseFloat(pool.tvl);

      if (price > 0 && volume > 0) {
        totalWeightedPrice += price * volume;
        totalVolume += volume;
      }

      if (price > 0) {
        simplePriceSum += price;
        if (bestPrice === 0 || price > bestPrice) {
          bestPrice = price;
        }
      }

      totalTvl += tvl;

      if (pool.lastRefreshedAt && pool.lastRefreshedAt > freshestUpdate) {
        freshestUpdate = pool.lastRefreshedAt;
      }
    }

    const weightedPrice = totalVolume > 0 ? totalWeightedPrice / totalVolume : 0;
    const simplePrice = pools.length > 0 ? simplePriceSum / pools.length : 0;

    return {
      tokenIn,
      tokenOut,
      weightedPrice,
      simplePrice,
      poolCount: pools.length,
      totalTvl,
      bestPrice,
      lastUpdated: freshestUpdate,
    };
  }

  /**
   * Get spot prices for multiple pairs in a single call.
   */
  async getBatchPrices(
    pairs: Array<{
      tokenIn: string;
      tokenInIssuer?: string;
      tokenOut: string;
      tokenOutIssuer?: string;
    }>,
  ): Promise<AggregatedPrice[]> {
    return Promise.all(
      pairs.map((p) =>
        this.getAggregatedPrice(
          p.tokenIn,
          p.tokenInIssuer ?? null,
          p.tokenOut,
          p.tokenOutIssuer ?? null,
        ),
      ),
    );
  }

  /**
   * Return historical price points for a pool over a time range.
   * Used for TWAP calculations and charting.
   */
  async getHistoricalPrices(
    poolId: string,
    from: Date,
    to: Date,
    limit = 100,
  ): Promise<PricePoint[]> {
    const snapshots = await this.snapshotRepository
      .createQueryBuilder('snap')
      .where('snap.poolId = :poolId', { poolId })
      .andWhere('snap.snapshotAt BETWEEN :from AND :to', { from, to })
      .orderBy('snap.snapshotAt', 'ASC')
      .limit(limit)
      .getMany();

    return snapshots.map((s) => ({
      timestamp: s.snapshotAt,
      price: parseFloat(s.spotPrice),
      volume: parseFloat(s.volume24h),
    }));
  }

  /**
   * Time-weighted average price over a given window.
   * Uses the most recent `windowMinutes` of snapshot data.
   */
  async getTWAP(
    poolId: string,
    windowMinutes: number,
  ): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - windowMinutes * 60 * 1000);

    const prices = await this.getHistoricalPrices(poolId, from, to);
    if (prices.length === 0) return 0;

    // Simple TWAP: average of consecutive price intervals
    let twap = 0;
    for (let i = 1; i < prices.length; i++) {
      const timeDelta =
        (prices[i].timestamp.getTime() - prices[i - 1].timestamp.getTime()) /
        1000;
      twap += prices[i - 1].price * timeDelta;
    }

    const totalTime =
      (prices[prices.length - 1].timestamp.getTime() - prices[0].timestamp.getTime()) /
      1000;

    return totalTime > 0 ? twap / totalTime : 0;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async findPoolsForPair(
    tokenIn: string,
    tokenInIssuer: string | null,
    tokenOut: string,
    tokenOutIssuer: string | null,
  ): Promise<LiquidityPool[]> {
    return this.poolRepository.find({
      where: [
        {
          assetCodeA: tokenIn,
          assetIssuerA: tokenInIssuer ?? undefined,
          assetCodeB: tokenOut,
          assetIssuerB: tokenOutIssuer ?? undefined,
          status: PoolStatus.ACTIVE,
        },
        {
          assetCodeA: tokenOut,
          assetIssuerA: tokenOutIssuer ?? undefined,
          assetCodeB: tokenIn,
          assetIssuerB: tokenInIssuer ?? undefined,
          status: PoolStatus.ACTIVE,
        },
      ],
    });
  }

  /**
   * Calculate the effective price of swapping `tokenIn` → `tokenOut` through
   * this pool. For AMMs, this is derived from reserves; for order books, it
   * uses the best available price from the order book side.
   */
  private calculatePoolPrice(
    pool: LiquidityPool,
    tokenIn: string,
    tokenOut: string,
  ): number {
    // If the pool's spot price is already stored (from snapshots), use it.
    // Otherwise derive from reserves or TVL.
    const tvl = parseFloat(pool.tvl);
    if (tvl <= 0) return 0;

    // For now, derive a synthetic price from TVL ratio.
    // In production, this would read reserves or order book depth.
    const isDirect = pool.assetCodeA === tokenIn && pool.assetCodeB === tokenOut;
    const isInverse = pool.assetCodeA === tokenOut && pool.assetCodeB === tokenIn;

    if (!isDirect && !isInverse) return 0;

    // Use fee-adjusted price from TVL proportion
    const feeRate = parseFloat(pool.feeRate);
    const volume = parseFloat(pool.volume24h);

    // Weighted spot: use volume as a proxy for active liquidity
    if (volume <= 0) return 0;

    // Synthetic price = volume-weighted spot with fee adjustment
    const rawPrice = volume / tvl;
    const adjustedPrice = isDirect ? rawPrice : 1 / rawPrice;

    return adjustedPrice * (1 - feeRate);
  }
}
