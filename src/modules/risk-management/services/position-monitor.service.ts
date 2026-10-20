import { Injectable, Logger } from '@nestjs/common';
import {
  ConcentrationRisk,
  Position,
  RiskAlert,
  RiskAlertSeverity,
} from '../interfaces/risk.types';

export interface RiskThresholds {
  /** Maximum share of the portfolio in a single asset, 0..1. */
  maxAssetShare?: number;
  /** Maximum share of the portfolio with a single counterparty, 0..1. */
  maxCounterpartyShare?: number;
  /** Absolute portfolio value above which a position is escalated. */
  maxPositionValue?: number;
}

/**
 * Tracks open positions in real time and raises alerts when the portfolio
 * breaches its configured risk limits.
 */
@Injectable()
export class PositionMonitorService {
  private readonly logger = new Logger(PositionMonitorService.name);
  private readonly positions = new Map<string, Position>();
  private readonly alerts: RiskAlert[] = [];

  upsertPosition(position: Position): void {
    this.positions.set(position.id, { ...position });
  }

  removePosition(positionId: string): boolean {
    return this.positions.delete(positionId);
  }

  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  listPositions(): Position[] {
    return [...this.positions.values()];
  }

  /** Updates the mark-to-market price of a position. */
  updatePrice(positionId: string, price: number): Position | undefined {
    const position = this.positions.get(positionId);
    if (!position) return undefined;
    position.currentPrice = price;
    this.positions.set(positionId, position);
    return position;
  }

  /** Total mark-to-market value of the portfolio. */
  portfolioValue(): number {
    return this.listPositions().reduce(
      (sum, position) => sum + this.positionValue(position),
      0,
    );
  }

  positionValue(position: Position): number {
    return Math.abs(position.quantity) * position.currentPrice;
  }

  /**
   * Computes concentration risk from the asset weights of the portfolio.
   * The Herfindahl index (sum of squared weights) gives a single number that
   * captures concentration across every asset at once.
   */
  concentration(thresholds: RiskThresholds = {}): ConcentrationRisk {
    const positions = this.listPositions();
    const total = this.portfolioValue();
    const breaches: string[] = [];

    if (total <= 0 || positions.length === 0) {
      return {
        level: 'low',
        topAssetShare: 0,
        herfindahlIndex: 0,
        breaches,
      };
    }

    const byAsset = new Map<string, number>();
    const byCounterparty = new Map<string, number>();
    for (const position of positions) {
      const value = this.positionValue(position);
      byAsset.set(position.asset, (byAsset.get(position.asset) ?? 0) + value);
      if (position.counterparty) {
        byCounterparty.set(
          position.counterparty,
          (byCounterparty.get(position.counterparty) ?? 0) + value,
        );
      }
    }

    let topAssetShare = 0;
    let herfindahlIndex = 0;
    for (const value of byAsset.values()) {
      const share = value / total;
      if (share > topAssetShare) topAssetShare = share;
      herfindahlIndex += share * share;
    }

    const maxAssetShare = thresholds.maxAssetShare ?? 0.5;
    if (topAssetShare > maxAssetShare) {
      breaches.push(
        `Largest asset exposure ${(topAssetShare * 100).toFixed(1)}% exceeds ` +
          `the ${(maxAssetShare * 100).toFixed(1)}% limit`,
      );
    }

    const maxCounterpartyShare = thresholds.maxCounterpartyShare ?? 0.6;
    for (const [counterparty, value] of byCounterparty.entries()) {
      const share = value / total;
      if (share > maxCounterpartyShare) {
        breaches.push(
          `Counterparty ${counterparty} holds ${(share * 100).toFixed(1)}% of the ` +
            `portfolio, above the ${(maxCounterpartyShare * 100).toFixed(1)}% limit`,
        );
      }
    }

    const level: ConcentrationRisk['level'] =
      topAssetShare > 0.7 || herfindahlIndex > 0.5
        ? 'high'
        : topAssetShare > maxAssetShare || herfindahlIndex > 0.3
          ? 'medium'
          : 'low';

    return { level, topAssetShare, herfindahlIndex, breaches };
  }

  /**
   * Impermanent loss for a 50/50 liquidity-provider position, expressed as a
   * positive fraction of the undeposited value.
   */
  impermanentLoss(position: Position): number {
    if (!position.isLiquidityProvider || position.entryPrice <= 0) return 0;
    const ratio = position.currentPrice / position.entryPrice;
    if (ratio <= 0) return 1;
    const valueRatio = (2 * Math.sqrt(ratio)) / (1 + ratio);
    return Math.max(0, 1 - valueRatio);
  }

  /**
   * Evaluates the configured thresholds and records any alerts.
   * Existing alerts are cleared and rebuilt on each call.
   */
  evaluateThresholds(thresholds: RiskThresholds = {}): RiskAlert[] {
    this.alerts.length = 0;
    const positions = this.listPositions();
    const total = this.portfolioValue();

    for (const position of positions) {
      const value = this.positionValue(position);
      if (
        thresholds.maxPositionValue !== undefined &&
        value > thresholds.maxPositionValue
      ) {
        this.raise({
          severity: 'warning',
          type: 'position-size',
          message:
            `Position ${position.id} is worth ${value.toFixed(2)}, above the ` +
            `configured maximum`,
          positionId: position.id,
          metadata: { value },
        });
      }

      const il = this.impermanentLoss(position);
      if (il > 0.05) {
        this.raise({
          severity: 'info',
          type: 'impermanent-loss',
          message:
            `Position ${position.id} is down ${(il * 100).toFixed(2)}% to ` +
            `impermanent loss`,
          positionId: position.id,
          metadata: { impermanentLoss: il },
        });
      }
    }

    const concentration = this.concentration(thresholds);
    for (const breach of concentration.breaches) {
      this.raise({
        severity: 'critical',
        type: 'concentration',
        message: breach,
        metadata: { level: concentration.level },
      });
    }

    if (total <= 0 && positions.length > 0) {
      this.raise({
        severity: 'warning',
        type: 'portfolio-value',
        message: 'Portfolio has a non-zero position count but a zero value',
        metadata: { positionCount: positions.length },
      });
    }

    return [...this.alerts];
  }

  listAlerts(): RiskAlert[] {
    return [...this.alerts];
  }

  private raise(alert: Omit<RiskAlert, 'id' | 'raisedAt'>): void {
    const entry: RiskAlert = {
      ...alert,
      id: `${alert.type}-${alert.positionId ?? 'portfolio'}-${this.alerts.length}`,
      raisedAt: new Date(),
    };
    this.alerts.push(entry);
    this.logger.warn(`Risk alert: ${entry.message}`);
  }
}
