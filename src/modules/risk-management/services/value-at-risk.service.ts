import { Injectable } from '@nestjs/common';
import { Position, VaRResult, VarMethod } from '../interfaces/risk.types';

/**
 * Value-at-Risk calculator.
 *
 * Supports the historical-simulation method (percentile of realised returns)
 * and the parametric method (mean/standard-deviation with a normal
 * assumption). Both are computed in memory over the position set, so a
 * portfolio of a few hundred assets resolves in single-digit milliseconds.
 */
@Injectable()
export class ValueAtRiskService {
  /**
   * Historical-simulation VaR: the loss that is not exceeded with the given
   * confidence, derived from the supplied return series.
   */
  historical(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    const percentile = sorted[Math.min(index, sorted.length - 1)];
    return Math.abs(Math.min(0, percentile));
  }

  /** Parametric (variance-covariance) VaR over a return series. */
  parametric(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    const mean = this.mean(returns);
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    return Math.abs(mean - this.zScore(confidence) * stdDev);
  }

  /**
   * Computes portfolio VaR from per-asset return series.
   *
   * Each asset's returns are scaled by its share of portfolio value, so the
   * resulting figure is a portfolio-level loss in quote currency.
   */
  calculate(
    positions: Position[],
    returnsByAsset: Record<string, number[]>,
    method: VarMethod = 'historical',
  ): VaRResult {
    const startedAt = process.hrtime.bigint();
    const totalValue = positions.reduce(
      (sum, position) => sum + this.positionValue(position),
      0,
    );

    let sampleSize = 0;
    const portfolioReturns: number[] = [];

    if (totalValue > 0) {
      for (const position of positions) {
        const returns = returnsByAsset[position.asset];
        if (!returns || returns.length === 0) continue;
        const weight = this.positionValue(position) / totalValue;
        if (portfolioReturns.length === 0) {
          portfolioReturns.push(...returns.map(() => 0));
        }
        const length = Math.min(portfolioReturns.length, returns.length);
        for (let i = 0; i < length; i++) {
          portfolioReturns[i] += returns[i] * weight;
        }
        sampleSize = Math.max(sampleSize, returns.length);
      }
    }

    const valueAtRisk95 =
      this.portfolioVar(portfolioReturns, 0.95, method) * totalValue;
    const valueAtRisk99 =
      this.portfolioVar(portfolioReturns, 0.99, method) * totalValue;

    return {
      valueAtRisk95,
      valueAtRisk99,
      method,
      sampleSize,
      computedAt: new Date(),
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    };
  }

  /** Value of a position at its current price. */
  positionValue(position: Position): number {
    return Math.abs(position.quantity) * position.currentPrice;
  }

  /** PnL of a position between entry and current price. */
  unrealizedPnl(position: Position): number {
    const direction = position.quantity < 0 ? -1 : 1;
    return direction * (position.currentPrice - position.entryPrice) * Math.abs(position.quantity);
  }

  private portfolioVar(
    returns: number[],
    confidence: number,
    method: VarMethod,
  ): number {
    if (returns.length === 0) return 0;
    return method === 'historical'
      ? this.historical(returns, confidence)
      : this.parametric(returns, confidence);
  }

  private mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  /**
   * Inverse standard-normal CDF (Acklam's rational approximation), accurate
   * to roughly 1e-9 across the open interval.
   */
  private zScore(p: number): number {
    if (p <= 0 || p >= 1) {
      throw new Error('Confidence level must be strictly between 0 and 1');
    }
    const a = [
      -39.6968302866538, 220.946098424521, -275.928510446969,
      138.357751867269, -30.6647980661472, 2.50662827745924,
    ];
    const b = [
      -54.4760987982241, 161.585836858041, -155.698979859887,
      66.8013118877197, -13.2806815528857,
    ];
    const c = [
      -0.00778489400243029, -0.322396458041136, -2.40075827716184,
      -2.54973253934373, 4.37466414146497, 2.93816398269878,
    ];
    const d = [
      0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742,
    ];

    const pLow = 0.02425;
    if (p < pLow) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
    if (p <= 1 - pLow) {
      const q = p - 0.5;
      const r = q * q;
      return (
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
          q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    }
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}
