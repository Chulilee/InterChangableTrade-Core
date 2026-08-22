import { Injectable, Logger } from '@nestjs/common';
import { SorobanClientService } from './soroban-client.service';
import { GasEstimate } from './soroban.types';

/**
 * Gas optimization suggestions for a transaction
 */
export interface GasOptimization {
  /** Original estimated gas */
  originalEstimate: GasEstimate;
  /** Optimized gas estimate after applying improvements */
  optimizedEstimate: GasEstimate;
  /** List of optimizations that were applied */
  optimizationsApplied: string[];
  /** Potential savings in stroops */
  estimatedSavings: string;
  /** Percentage savings compared to original */
  savingsPercentage: number;
}

/**
 * Historical gas usage for pattern analysis
 */
interface GasUsageHistory {
  contractId: string;
  method: string;
  gasUsed: string;
  timestamp: number;
  ledger: number;
}

/**
 * Advanced gas optimization engine that predicts and optimizes Soroban gas costs.
 * Uses historical data and simulation to minimize transaction fees while
 * ensuring sufficient gas for successful execution.
 */
@Injectable()
export class GasOptimizationEngine {
  private readonly logger = new Logger(GasOptimizationEngine.name);
  private readonly history: GasUsageHistory[] = [];
  private readonly maxHistorySize = 1000;
  private readonly safetyBuffer = 0.1; // 10% safety buffer on gas estimates

  constructor(private readonly client: SorobanClientService) {}

  /**
   * Optimize gas costs for a potential transaction
   * Analyzes the call and suggests optimizations to reduce fees
   */
  async optimizeGas(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    currentEstimate: GasEstimate,
  ): Promise<GasOptimization> {
    const optimizationsApplied: string[] = [];
    let optimizedMinResourceFee = BigInt(currentEstimate.minResourceFee);
    
    // Apply various optimization strategies
    const historicalAvg = this.getHistoricalAverage(contractId, method);
    if (historicalAvg) {
      // Use historical data to set a more accurate gas limit
      const historicalBigInt = BigInt(historicalAvg);
      if (historicalBigInt < optimizedMinResourceFee) {
        optimizedMinResourceFee = historicalBigInt;
        optimizationsApplied.push('historical-data-calibration');
      }
    }

    // Check if we can reduce the safety buffer for stable methods
    if (this.isMethodStable(contractId, method)) {
      // Stable methods can use a smaller buffer
      optimizedMinResourceFee = this.applyBuffer(optimizedMinResourceFee, 0.05); // 5% buffer instead of 10%
      optimizationsApplied.push('reduced-safety-buffer-stable-method');
    } else {
      optimizedMinResourceFee = this.applyBuffer(optimizedMinResourceFee, this.safetyBuffer);
    }

    // Check for batching opportunities
    if (this.canBatchWithSimilarCalls(contractId, method)) {
      optimizationsApplied.push('batching-opportunity-detected');
    }

    // Calculate savings
    const originalBigInt = BigInt(currentEstimate.minResourceFee);
    const savings = originalBigInt - optimizedMinResourceFee;
    const savingsPercentage = Number((savings * 100n) / originalBigInt);

    const optimization: GasOptimization = {
      originalEstimate: currentEstimate,
      optimizedEstimate: {
        ...currentEstimate,
        minResourceFee: optimizedMinResourceFee.toString(),
      },
      optimizationsApplied,
      estimatedSavings: savings.toString(),
      savingsPercentage,
    };

    this.logger.debug(
      `Gas optimization for ${contractId}.${method}: saved ${savings.toString()} stroops (${savingsPercentage}%)`,
    );

    return optimization;
  }

  /**
   * Record actual gas usage after transaction execution
   * Builds historical data for future optimizations
   */
  recordGasUsage(usage: GasUsageHistory): void {
    this.history.push(usage);
    
    // Maintain history size limit
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Predict gas usage for a method based on historical data
   */
  predictGasUsage(contractId: string, method: string): GasEstimate | null {
    const relevant = this.history.filter(
      h => h.contractId === contractId && h.method === method,
    );

    if (relevant.length === 0) return null;

    // Calculate average gas used
    const sum = relevant.reduce((acc, h) => acc + BigInt(h.gasUsed), 0n);
    const avg = sum / BigInt(relevant.length);

    return {
      minResourceFee: avg.toString(),
    };
  }

  /**
   * Check if a method has stable gas usage (low variance)
   */
  private isMethodStable(contractId: string, method: string): boolean {
    const relevant = this.history.filter(
      h => h.contractId === contractId && h.method === method,
    );

    if (relevant.length < 10) return false; // Need enough data points

    // Calculate variance to determine stability
    const values = relevant.map(h => BigInt(h.gasUsed));
    const avg = values.reduce((a, b) => a + b, 0n) / BigInt(values.length);
    
    // If all recent values are within 20% of average, consider stable
    const variance = values.every(v => {
      const diff = v > avg ? v - avg : avg - v;
      return (diff * 100n) / avg < 20n;
    });

    return variance;
  }

  /**
   * Check if there are similar pending calls that could be batched
   */
  private canBatchWithSimilarCalls(contractId: string, method: string): boolean {
    // In a real implementation, this would check pending transactions
    // For now, return false as a placeholder
    return false;
  }

  /**
   * Get the historical average gas usage for a method
   */
  private getHistoricalAverage(contractId: string, method: string): string | null {
    const prediction = this.predictGasUsage(contractId, method);
    return prediction?.minResourceFee || null;
  }

  /**
   * Apply a safety buffer to a gas value
   */
  private applyBuffer(value: bigint, bufferPercent: number): bigint {
    const buffer = BigInt(Math.floor(Number(value) * bufferPercent));
    return value + buffer;
  }

  /**
   * Get gas usage statistics for monitoring
   */
  getStatistics() {
    const contractStats = new Map<string, Map<string, { count: number; avgGas: string }>>();
    
    for (const usage of this.history) {
      if (!contractStats.has(usage.contractId)) {
        contractStats.set(usage.contractId, new Map());
      }
      
      const methodStats = contractStats.get(usage.contractId)!;
      if (!methodStats.has(usage.method)) {
        methodStats.set(usage.method, { count: 0, avgGas: '0' });
      }
      
      const stats = methodStats.get(usage.method)!;
      stats.count++;
      const current = BigInt(stats.avgGas);
      const newAvg = (current * BigInt(stats.count - 1) + BigInt(usage.gasUsed)) / BigInt(stats.count);
      stats.avgGas = newAvg.toString();
    }

    return contractStats;
  }
}