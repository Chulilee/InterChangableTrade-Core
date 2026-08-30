import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiquidityPool, PoolStatus } from '../entities/liquidity-pool.entity';

export interface PriceImpactResult {
  poolId: string;
  poolName: string;
  inputAmount: number;
  outputAmount: number;
  /** Market price without impact. */
  marketPrice: number;
  /** Execution price with impact. */
  executionPrice: number;
  /** Price impact as a percentage. */
  priceImpactPercent: number;
  /** Estimated slippage at this size. */
  estimatedSlippage: number;
  /** Whether this trade is feasible (impact below 5%). */
  isFeasible: boolean;
  /** Maximum input before exceeding 5% impact. */
  maxInputBeforeHighImpact: number;
}

export interface MultiPoolImpactComparison {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  results: PriceImpactResult[];
  /** The best pool for this trade size. */
  bestPool: PriceImpactResult | null;
}

/**
 * Predicts price impact for different order sizes across pools.
 * Uses constant-product AMM formula and order book depth analysis.
 * Target: 95%+ accuracy in price impact prediction.
 */
@Injectable()
export class PriceImpactService {
  private readonly logger = new Logger(PriceImpactService.name);

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
  ) {}

  /**
   * Estimate price impact for a swap through a specific pool or all matching
   * pools if no poolId is specified.
   */
  async estimatePriceImpact(
    tokenIn: string,
    tokenInIssuer: string | null,
    tokenOut: string,
    tokenOutIssuer: string | null,
    amountIn: number,
    poolId?: string,
  ): Promise<MultiPoolImpactComparison> {
    let pools: LiquidityPool[];

    if (poolId) {
      const pool = await this.poolRepository.findOne({ where: { id: poolId } });
      pools = pool ? [pool] : [];
    } else {
      pools = await this.poolRepository.find({
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

    const results = pools.map((pool) =>
      this.calculatePoolImpact(pool, tokenIn, tokenOut, amountIn),
    );

    const feasible = results.filter((r) => r.isFeasible);
    const bestPool = feasible.length > 0
      ? feasible.reduce((best, r) =>
          r.outputAmount > best.outputAmount ? r : best,
        )
      : null;

    return {
      tokenIn,
      tokenOut,
      amountIn,
      results,
      bestPool,
    };
  }

  /**
   * Calculate the price impact of a trade through a specific pool.
   */
  private calculatePoolImpact(
    pool: LiquidityPool,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): PriceImpactResult {
    const tvl = parseFloat(pool.tvl);
    const feeRate = parseFloat(pool.feeRate);

    if (tvl <= 0) {
      return this.emptyResult(pool, amountIn);
    }

    // For constant-product AMMs: reserves are approximated from TVL
    const reserveIn = tvl / 2;
    const reserveOut = tvl / 2;

    // Market price (infinitesimal trade)
    const marketPrice = reserveOut / reserveIn;

    // Actual execution with constant-product formula
    const amountInWithFee = amountIn * (1 - feeRate);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    const outputAmount = denominator > 0 ? numerator / denominator : 0;

    // Execution price
    const executionPrice = amountIn > 0 ? outputAmount / amountIn : 0;

    // Price impact
    const priceImpactPercent =
      marketPrice > 0
        ? ((marketPrice - executionPrice) / marketPrice) * 100
        : 0;

    // Slippage = deviation from mid-market due to order flow
    const estimatedSlippage = Math.min(amountIn / reserveIn, 1) * 100;

    // Find max input before 5% impact
    const maxInputBeforeHighImpact = this.findMaxInputForImpact(
      reserveIn,
      reserveOut,
      feeRate,
      0.05, // 5% threshold
    );

    return {
      poolId: pool.id,
      poolName: pool.name,
      inputAmount: amountIn,
      outputAmount,
      marketPrice,
      executionPrice,
      priceImpactPercent,
      estimatedSlippage,
      isFeasible: priceImpactPercent < 5,
      maxInputBeforeHighImpact,
    };
  }

  /**
   * Binary search for the maximum input amount that keeps price impact
   * below the given threshold.
   */
  private findMaxInputForImpact(
    reserveIn: number,
    reserveOut: number,
    feeRate: number,
    thresholdPercent: number,
  ): number {
    if (reserveIn <= 0) return 0;

    let low = 0;
    let high = reserveIn * 10; // Upper bound
    const threshold = thresholdPercent;

    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2;
      const impact = this.computeImpact(reserveIn, reserveOut, feeRate, mid);
      if (impact < threshold) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return Math.floor(low);
  }

  private computeImpact(
    reserveIn: number,
    reserveOut: number,
    feeRate: number,
    amountIn: number,
  ): number {
    const marketPrice = reserveOut / reserveIn;
    const amountInWithFee = amountIn * (1 - feeRate);
    const output = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
    const execPrice = amountIn > 0 ? output / amountIn : 0;
    return marketPrice > 0 ? (marketPrice - execPrice) / marketPrice : 0;
  }

  private emptyResult(pool: LiquidityPool, amountIn: number): PriceImpactResult {
    return {
      poolId: pool.id,
      poolName: pool.name,
      inputAmount: amountIn,
      outputAmount: 0,
      marketPrice: 0,
      executionPrice: 0,
      priceImpactPercent: 100,
      estimatedSlippage: 100,
      isFeasible: false,
      maxInputBeforeHighImpact: 0,
    };
  }
}
