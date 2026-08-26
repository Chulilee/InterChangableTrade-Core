import { Injectable } from '@nestjs/common';
import { Contract, SorobanContract } from '../soroban-contract.base';
import { InvocationResult, SimulationResult } from '../soroban.types';

/**
 * Swap pool reserves information
 */
export interface PoolReserves {
  reserveA: string;
  reserveB: string;
  lastUpdateTimestamp: number;
}

/**
 * Swap quote result
 */
export interface SwapQuote {
  amountOut: string;
  fee: string;
  priceImpact: number;
}

/**
 * Swap pool contract implementation that extends the base SorobanContract.
 * Provides type-safe methods for interacting with a decentralized exchange
 * pool contract on Soroban.
 *
 * The @Contract decorator registers this as a "swap-pool" type contract,
 * enabling automatic validation when initializing instances.
 */
@Contract('swap-pool')
@Injectable()
export class SwapPoolContract extends SorobanContract {
  /**
   * Get the current pool reserves
   */
  async getReserves(): Promise<SimulationResult<PoolReserves>> {
    return this.simulate<PoolReserves>('get_reserves');
  }

  /**
   * Get a quote for swapping token A to B
   */
  async quoteSwap(
    amountIn: string,
    tokenIn: string,
  ): Promise<SimulationResult<SwapQuote>> {
    return this.simulate<SwapQuote>('quote_swap', {
      amount_in: amountIn,
      token_in: tokenIn,
    });
  }

  /**
   * Execute a swap from token A to B
   */
  async swap(
    amountIn: string,
    minAmountOut: string,
    tokenIn: string,
    recipient: string,
  ): Promise<InvocationResult<{ amountOut: string }>> {
    return this.invoke<{ amountOut: string }>('swap', {
      amount_in: amountIn,
      min_amount_out: minAmountOut,
      token_in: tokenIn,
      recipient,
    });
  }

  /**
   * Add liquidity to the pool
   */
  async addLiquidity(
    amountADesired: string,
    amountBDesired: string,
    amountAMin: string,
    amountBMin: string,
    recipient: string,
    deadline: number,
  ): Promise<
    InvocationResult<{ liquidity: string; amountA: string; amountB: string }>
  > {
    return this.invoke('add_liquidity', {
      amount_a_desired: amountADesired,
      amount_b_desired: amountBDesired,
      amount_a_min: amountAMin,
      amount_b_min: amountBMin,
      recipient,
      deadline,
    });
  }

  /**
   * Remove liquidity from the pool
   */
  async removeLiquidity(
    liquidity: string,
    amountAMin: string,
    amountBMin: string,
    recipient: string,
    deadline: number,
  ): Promise<InvocationResult<{ amountA: string; amountB: string }>> {
    return this.invoke('remove_liquidity', {
      liquidity,
      amount_a_min: amountAMin,
      amount_b_min: amountBMin,
      recipient,
      deadline,
    });
  }

  /**
   * Get the token addresses in this pool
   */
  async getTokens(): Promise<
    SimulationResult<{ tokenA: string; tokenB: string }>
  > {
    return this.simulate<{ tokenA: string; tokenB: string }>('get_tokens');
  }

  /**
   * Get the current spot price of token B denominated in token A
   */
  async getPrice(): Promise<SimulationResult<{ price: string }>> {
    return this.simulate<{ price: string }>('get_price');
  }
}
