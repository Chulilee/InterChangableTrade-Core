import { Injectable } from '@nestjs/common';
import {
  MarketConditions,
  ThresholdProfile,
} from '../interfaces/authorization.types';

export interface BaseThresholdConfig {
  /** Amount below which no extra controls apply. */
  baseAmount: number;
  /** Hard floor; amounts below this are always rejected. */
  minAmount: number;
  /** Ceiling for a single action under calm market conditions. */
  maxAmount: number;
  /** Signatures required for an action at or above `baseAmount`. */
  requiredSignatures: number;
}

/**
 * Derives dynamic thresholds from the current market state.
 *
 * Volatile, illiquid markets tighten the per-action ceiling and raise the
 * number of required signatures; deep, calm markets relax them. The result is
 * a `ThresholdProfile` that callers apply to high-value actions.
 */
@Injectable()
export class ThresholdManagerService {
  private config: BaseThresholdConfig = {
    baseAmount: 1_000,
    minAmount: 0.01,
    maxAmount: 100_000,
    requiredSignatures: 2,
  };

  configure(config: Partial<BaseThresholdConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): BaseThresholdConfig {
    return { ...this.config };
  }

  /**
   * Computes the thresholds that apply given the current market conditions.
   *
   * - `volatility` in [0, 1] scales the ceiling down (up to 75% reduction).
   * - `liquidity` in [0, 1] scales the ceiling up (up to 25% increase).
   * - `volume` in [0, 1] adds an extra signature above 0.6.
   */
  calculate(conditions: MarketConditions = {}): ThresholdProfile {
    const volatility = this.clamp(conditions.volatility ?? 0);
    const liquidity = this.clamp(conditions.liquidity ?? 1);
    const volume = this.clamp(conditions.volume ?? 0);

    const volatilityFactor = 1 - 0.75 * volatility;
    const liquidityFactor = 1 + 0.25 * (1 - liquidity);

    const maxAmount = Math.max(
      this.config.minAmount,
      Math.round(this.config.maxAmount * volatilityFactor * liquidityFactor),
    );

    let requiredSignatures = this.config.requiredSignatures;
    if (volume > 0.6) requiredSignatures += 1;
    if (volatility > 0.75) requiredSignatures += 1;

    const rationale = [
      `base=${this.config.baseAmount}`,
      `volatility=${volatility.toFixed(2)}`,
      `liquidity=${liquidity.toFixed(2)}`,
      `volume=${volume.toFixed(2)}`,
    ].join(' ');

    return {
      baseAmount: this.config.baseAmount,
      minAmount: this.config.minAmount,
      maxAmount,
      requiredSignatures,
      rationale,
    };
  }

  /** True when the amount falls inside the dynamic envelope. */
  isWithinLimits(amount: number, profile: ThresholdProfile): boolean {
    return amount >= profile.minAmount && amount <= profile.maxAmount;
  }

  /** True when the amount is high enough to require extra signatures. */
  requiresMultiSignature(amount: number, profile: ThresholdProfile): boolean {
    return amount >= profile.baseAmount && profile.requiredSignatures > 1;
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }
}
