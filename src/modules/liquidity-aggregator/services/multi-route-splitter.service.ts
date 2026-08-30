import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiquidityPool, PoolStatus } from '../entities/liquidity-pool.entity';

export interface SplitAllocation {
  poolId: string;
  poolName: string;
  /** Fraction of total input allocated to this pool (0-1). */
  fraction: number;
  /** Absolute amount of tokenIn allocated. */
  amountIn: number;
  /** Expected output from this allocation. */
  expectedOutput: number;
  /** Price impact for this sub-trade. */
  priceImpact: number;
}

export interface SplitRouteResult {
  tokenIn: string;
  tokenOut: string;
  totalAmountIn: number;
  totalExpectedOutput: number;
  /** Blended price across all splits. */
  blendedPrice: number;
  /** Price improvement vs single-pool execution. */
  improvementOverSingle: number;
  /** Number of pools used. */
  splitCount: number;
  /** Detailed allocation per pool. */
  allocations: SplitAllocation[];
}

/**
 * Automatically splits large orders across multiple pools for better
 * execution. Uses a greedy algorithm that assigns marginal amounts to the
 * pool with the best marginal output at each step.
 */
@Injectable()
export class MultiRouteSplitterService {
  private readonly logger = new Logger(MultiRouteSplitterService.name);

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
  ) {}

  /**
   * Find the optimal split of `amountIn` across up to `numSplits` pools.
   *
   * Algorithm: iterative marginal allocation — at each step, assign the
   * next marginal unit to whichever pool currently offers the best output
   * for that unit, accounting for the diminishing returns in each pool.
   */
  async findOptimalSplit(
    tokenIn: string,
    tokenInIssuer: string | null,
    tokenOut: string,
    tokenOutIssuer: string | null,
    amountIn: number,
    numSplits: number,
  ): Promise<SplitRouteResult> {
    const pools = await this.poolRepository.find({
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

    if (pools.length === 0) {
      return this.emptyResult(tokenIn, tokenOut, amountIn);
    }

    const activePools = pools.slice(0, numSplits);
    const allocations = await this.greedyAllocate(
      activePools,
      tokenIn,
      tokenOut,
      amountIn,
    );

    // Calculate totals
    const totalOutput = allocations.reduce((s, a) => s + a.expectedOutput, 0);
    const blendedPrice = amountIn > 0 ? totalOutput / amountIn : 0;

    // Compare with single-pool execution (best single pool)
    const singlePoolOutput = await this.bestSinglePoolOutput(
      activePools,
      tokenIn,
      tokenOut,
      amountIn,
    );

    const improvementOverSingle =
      singlePoolOutput > 0
        ? ((totalOutput - singlePoolOutput) / singlePoolOutput) * 100
        : 0;

    return {
      tokenIn,
      tokenOut,
      totalAmountIn: amountIn,
      totalExpectedOutput: totalOutput,
      blendedPrice,
      improvementOverSingle,
      splitCount: allocations.length,
      allocations,
    };
  }

  // ─── Greedy allocation ───────────────────────────────────────────────────

  private async greedyAllocate(
    pools: LiquidityPool[],
    tokenIn: string,
    tokenOut: string,
    totalAmount: number,
  ): Promise<SplitAllocation[]> {
    const STEP_SIZE = totalAmount / 100; // Divide into 100 marginal steps
    const allocated = new Map<string, number>(); // poolId → cumulative input
    const allocations = new Map<string, SplitAllocation>();

    // Initialize allocations
    for (const pool of pools) {
      allocated.set(pool.id, 0);
      allocations.set(pool.id, {
        poolId: pool.id,
        poolName: pool.name,
        fraction: 0,
        amountIn: 0,
        expectedOutput: 0,
        priceImpact: 0,
      });
    }

    let remaining = totalAmount;
    const steps = Math.ceil(totalAmount / STEP_SIZE);

    for (let i = 0; i < steps && remaining > 0; i++) {
      const stepAmount = Math.min(STEP_SIZE, remaining);
      let bestPoolId = pools[0].id;
      let bestMarginalOutput = 0;

      // For each pool, compute marginal output of this step
      for (const pool of pools) {
        const currentInput = allocated.get(pool.id) ?? 0;
        const marginalOutput = this.simulateMarginalSwap(
          pool,
          tokenIn,
          tokenOut,
          currentInput,
          stepAmount,
        );

        if (marginalOutput > bestMarginalOutput) {
          bestMarginalOutput = marginalOutput;
          bestPoolId = pool.id;
        }
      }

      // Allocate to best pool
      const prev = allocated.get(bestPoolId) ?? 0;
      allocated.set(bestPoolId, prev + stepAmount);
      remaining -= stepAmount;

      // Update allocation record
      const alloc = allocations.get(bestPoolId)!;
      alloc.amountIn += stepAmount;
      alloc.expectedOutput += bestMarginalOutput;
    }

    // Finalize fractions and price impacts
    const result: SplitAllocation[] = [];
    for (const pool of pools) {
      const alloc = allocations.get(pool.id)!;
      if (alloc.amountIn <= 0) continue;

      alloc.fraction = alloc.amountIn / totalAmount;
      alloc.priceImpact = this.computeSingleImpact(
        pool,
        tokenIn,
        tokenOut,
        alloc.amountIn,
      );
      result.push(alloc);
    }

    return result.sort((a, b) => b.amountIn - a.amountIn);
  }

  private simulateMarginalSwap(
    pool: LiquidityPool,
    tokenIn: string,
    tokenOut: string,
    currentInput: number,
    marginalAmount: number,
  ): number {
    const tvl = parseFloat(pool.tvl);
    const feeRate = parseFloat(pool.feeRate);
    if (tvl <= 0) return 0;

    const reserveIn = tvl / 2;
    const reserveOut = tvl / 2;
    const totalInput = currentInput + marginalAmount;

    // Output at totalInput
    const totalOutput = this.constantProductOutput(
      reserveIn,
      reserveOut,
      feeRate,
      totalInput,
    );

    // Output at currentInput
    const currentOutput = this.constantProductOutput(
      reserveIn,
      reserveOut,
      feeRate,
      currentInput,
    );

    // Marginal output = delta
    return Math.max(0, totalOutput - currentOutput);
  }

  private constantProductOutput(
    reserveIn: number,
    reserveOut: number,
    feeRate: number,
    amountIn: number,
  ): number {
    const amountInWithFee = amountIn * (1 - feeRate);
    const denominator = reserveIn + amountInWithFee;
    return denominator > 0
      ? (amountInWithFee * reserveOut) / denominator
      : 0;
  }

  private computeSingleImpact(
    pool: LiquidityPool,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): number {
    const tvl = parseFloat(pool.tvl);
    if (tvl <= 0) return 100;
    const marketPrice = 1; // Equal reserves assumption
    const execPrice =
      this.constantProductOutput(tvl / 2, tvl / 2, parseFloat(pool.feeRate), amountIn) /
      (amountIn || 1);
    return marketPrice > 0
      ? ((marketPrice - execPrice) / marketPrice) * 100
      : 100;
  }

  private async bestSinglePoolOutput(
    pools: LiquidityPool[],
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): Promise<number> {
    let best = 0;
    for (const pool of pools) {
      const output = this.simulateMarginalSwap(
        pool,
        tokenIn,
        tokenOut,
        0,
        amountIn,
      );
      if (output > best) best = output;
    }
    return best;
  }

  private emptyResult(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
  ): SplitRouteResult {
    return {
      tokenIn,
      tokenOut,
      totalAmountIn: amountIn,
      totalExpectedOutput: 0,
      blendedPrice: 0,
      improvementOverSingle: 0,
      splitCount: 0,
      allocations: [],
    };
  }
}
