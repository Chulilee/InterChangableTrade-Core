import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiquidityPool, PoolStatus } from '../entities/liquidity-pool.entity';

export interface SimulationStep {
  poolId: string;
  poolName: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  fee: number;
  priceImpact: number;
  effectivePrice: number;
}

export interface SimulationResult {
  poolPath: string[];
  inputAmount: number;
  finalOutput: number;
  /** Execution price = finalOutput / inputAmount. */
  executionPrice: number;
  /** Sum of fees across all hops. */
  totalFees: number;
  /** Overall price impact of the full route. */
  overallPriceImpact: number;
  /** Whether this route is feasible with current liquidity. */
  isFeasible: boolean;
  /** Individual step breakdown. */
  steps: SimulationStep[];
  /** Estimated gas for the full route. */
  estimatedGas: number;
  /** Whether simulation succeeded on-chain (false = dry-run only). */
  onChainValidated: boolean;
  /** Timestamp of simulation. */
  simulatedAt: Date;
}

/**
 * Dry-runs swap routes against current pool state to validate feasibility
 * before committing to execution. Simulates each hop independently,
 * accounting for cascading price impact.
 */
@Injectable()
export class RouteExecutionSimulatorService {
  private readonly logger = new Logger(RouteExecutionSimulatorService.name);

  /** Base gas per Soroban contract invocation (stroops). */
  private readonly BASE_GAS_PER_HOP = 100_000;
  /** Max price impact before flagging as infeasible. */
  private readonly MAX_ACCEPTABLE_IMPACT = 0.10; // 10%

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
  ) {}

  /**
   * Simulate executing a route through the given pools. Returns a detailed
   * step-by-step breakdown and overall feasibility assessment.
   */
  async simulateRoute(
    poolPath: string[],
    amountIn: number,
    minAmountOut?: number,
  ): Promise<SimulationResult> {
    if (poolPath.length === 0) {
      throw new BadRequestException('Pool path must not be empty');
    }

    const pools = await this.loadPools(poolPath);
    const steps: SimulationStep[] = [];

    let currentAmount = amountIn;
    let totalFees = 0;
    let cumulativeImpact = 1; // multiplicative factor

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const previousAsset = i === 0 ? pool.assetCodeA : this.determineOutputAsset(pool, steps[i - 1]?.tokenOut ?? '');
      const nextAsset = i === 0 ? pool.assetCodeB : this.determineInputAsset(pool, steps[i - 1]?.tokenOut ?? '');

      const tvl = parseFloat(pool.tvl);
      const feeRate = parseFloat(pool.feeRate);

      if (tvl <= 0) {
        steps.push({
          poolId: pool.id,
          poolName: pool.name,
          tokenIn: previousAsset,
          tokenOut: nextAsset,
          amountIn: currentAmount,
          amountOut: 0,
          fee: 0,
          priceImpact: 100,
          effectivePrice: 0,
        });
        break;
      }

      // Constant-product AMM simulation
      const reserveIn = tvl / 2;
      const reserveOut = tvl / 2;
      const amountInWithFee = currentAmount * (1 - feeRate);
      const denominator = reserveIn + amountInWithFee;
      const amountOut = denominator > 0 ? (amountInWithFee * reserveOut) / denominator : 0;
      const fee = currentAmount * feeRate;

      // Price impact for this step
      const marketPrice = reserveOut / reserveIn;
      const execPrice = amountOut / (currentAmount || 1);
      const stepImpact = marketPrice > 0 ? (marketPrice - execPrice) / marketPrice : 1;

      cumulativeImpact *= 1 - stepImpact;
      totalFees += fee;

      steps.push({
        poolId: pool.id,
        poolName: pool.name,
        tokenIn: previousAsset,
        tokenOut: nextAsset,
        amountIn: currentAmount,
        amountOut,
        fee,
        priceImpact: stepImpact * 100,
        effectivePrice: execPrice,
      });

      currentAmount = amountOut;
    }

    const overallPriceImpact = (1 - cumulativeImpact) * 100;
    const isFeasible =
      currentAmount > 0 &&
      overallPriceImpact < this.MAX_ACCEPTABLE_IMPACT * 100 &&
      (minAmountOut === undefined || currentAmount >= minAmountOut);

    return {
      poolPath,
      inputAmount: amountIn,
      finalOutput: currentAmount,
      executionPrice: amountIn > 0 ? currentAmount / amountIn : 0,
      totalFees,
      overallPriceImpact,
      isFeasible,
      steps,
      estimatedGas: pools.length * this.BASE_GAS_PER_HOP,
      onChainValidated: false,
      simulatedAt: new Date(),
    };
  }

  /**
   * Simulate multiple alternative routes and return them sorted by output.
   */
  async simulateMultipleRoutes(
    routes: Array<{ poolPath: string[]; amountIn: number }>,
  ): Promise<SimulationResult[]> {
    const results = await Promise.all(
      routes.map((r) => this.simulateRoute(r.poolPath, r.amountIn)),
    );

    return results.sort((a, b) => b.finalOutput - a.finalOutput);
  }

  /**
   * Validate a route against live pool state without executing.
   * Returns a simplified pass/fail with reason.
   */
  async validateRoute(
    poolPath: string[],
    amountIn: number,
    minAmountOut: number,
  ): Promise<{
    valid: boolean;
    reason: string;
    simulatedOutput: number;
  }> {
    try {
      const result = await this.simulateRoute(poolPath, amountIn, minAmountOut);

      if (!result.isFeasible) {
        const reasons: string[] = [];
        if (result.overallPriceImpact >= this.MAX_ACCEPTABLE_IMPACT * 100) {
          reasons.push(`Price impact ${result.overallPriceImpact.toFixed(2)}% exceeds ${this.MAX_ACCEPTABLE_IMPACT * 100}%`);
        }
        if (result.finalOutput <= 0) {
          reasons.push('Zero output from route');
        }
        if (minAmountOut !== undefined && result.finalOutput < minAmountOut) {
          reasons.push(`Output ${result.finalOutput} below minimum ${minAmountOut}`);
        }
        return {
          valid: false,
          reason: reasons.join('; '),
          simulatedOutput: result.finalOutput,
        };
      }

      return {
        valid: true,
        reason: 'Route validated successfully',
        simulatedOutput: result.finalOutput,
      };
    } catch (error) {
      return {
        valid: false,
        reason: `Simulation failed: ${(error as Error).message}`,
        simulatedOutput: 0,
      };
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async loadPools(poolPath: string[]): Promise<LiquidityPool[]> {
    const pools = await this.poolRepository.find({
      where: poolPath.map((id) => ({ id, status: PoolStatus.ACTIVE })),
    });

    if (pools.length !== poolPath.length) {
      const foundIds = new Set(pools.map((p) => p.id));
      const missing = poolPath.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `Pools not found or inactive: ${missing.join(', ')}`,
      );
    }

    // Preserve path order
    return poolPath.map((id) => pools.find((p) => p.id === id)!);
  }

  /**
   * Determine which asset is the output of a pool given the input asset
   * from the previous step.
   */
  private determineOutputAsset(pool: LiquidityPool, inputAsset: string): string {
    if (pool.assetCodeA === inputAsset) return pool.assetCodeB;
    return pool.assetCodeA;
  }

  private determineInputAsset(pool: LiquidityPool, previousOutput: string): string {
    if (pool.assetCodeA === previousOutput) return pool.assetCodeB;
    return pool.assetCodeA;
  }
}
