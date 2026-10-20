import { Injectable } from '@nestjs/common';
import {
  Position,
  StressResult,
  StressScenario,
} from '../interfaces/risk.types';

/**
 * Stress-testing framework.
 *
 * Applies a market shock to the portfolio and reports the resulting loss,
 * the positions that would be liquidated and any limits that would be
 * breached. Scenarios are declarative so they can be stored and replayed.
 */
@Injectable()
export class StressTestingService {
  /** A small library of standard scenarios. */
  defaultScenarios(): StressScenario[] {
    return [
      {
        id: 'market-crash-50',
        name: '50% market crash',
        priceShock: -0.5,
        description: 'Broad sell-off across every asset',
      },
      {
        id: 'liquidity-crunch',
        name: '90% liquidity crunch',
        priceShock: -0.1,
        liquidityShock: -0.9,
        description: 'Small price move but most of the depth disappears',
      },
      {
        id: 'flash-crash-80',
        name: '80% flash crash',
        priceShock: -0.8,
        description: 'Severe shock that triggers liquidations',
      },
    ];
  }

  /** Runs a single scenario against the portfolio. */
  run(positions: Position[], scenario: StressScenario): StressResult {
    const before = this.totalValue(positions);
    const marginCalls: string[] = [];
    const breaches: string[] = [];
    let after = 0;

    for (const position of positions) {
      const shockedPrice = position.currentPrice * (1 + scenario.priceShock);
      let value = Math.abs(position.quantity) * shockedPrice;

      if (
        position.isLiquidityProvider &&
        scenario.liquidityShock !== undefined
      ) {
        // A liquidity crunch means the position cannot be exited at mark
        // price; only the remaining depth is realisable.
        const realisable = Math.max(0, 1 + scenario.liquidityShock);
        value *= realisable;
      }

      if (
        scenario.counterpartyShock !== undefined &&
        position.counterparty === scenario.counterpartyShock
      ) {
        // A counterparty default is assumed to be a total loss.
        value = 0;
        breaches.push(
          `Counterparty ${scenario.counterpartyShock} defaulted; position ` +
            `${position.id} written down to zero`,
        );
      }

      after += value;

      if (this.wouldBeLiquidated(position, shockedPrice)) {
        marginCalls.push(position.id);
      }
    }

    const loss = before - after;
    return {
      scenarioId: scenario.id,
      portfolioValueBefore: before,
      portfolioValueAfter: after,
      loss,
      lossPercent: before === 0 ? 0 : (loss / before) * 100,
      marginCalls,
      breaches,
      computedAt: new Date(),
    };
  }

  /** Runs a list of scenarios and returns every result. */
  runAll(
    positions: Position[],
    scenarios: StressScenario[],
  ): StressResult[] {
    return scenarios.map((scenario) => this.run(positions, scenario));
  }

  /**
   * Validates a model against a historical scenario by comparing the
   * predicted loss with the realised loss. Returns the absolute and
   * percentage error.
   */
  validateAgainstHistory(
    predictedLoss: number,
    realisedLoss: number,
  ): { absoluteError: number; percentageError: number } {
    const absoluteError = Math.abs(predictedLoss - realisedLoss);
    const percentageError =
      realisedLoss === 0 ? 0 : (absoluteError / Math.abs(realisedLoss)) * 100;
    return { absoluteError, percentageError };
  }

  private totalValue(positions: Position[]): number {
    return positions.reduce(
      (sum, position) =>
        sum + Math.abs(position.quantity) * position.currentPrice,
      0,
    );
  }

  private wouldBeLiquidated(position: Position, shockedPrice: number): boolean {
    const leverage = position.leverage ?? 1;
    if (leverage <= 1) return false;
    const margin = position.liquidationThreshold ?? 0.05;
    const isShort = position.quantity < 0;
    const liquidation = isShort
      ? position.entryPrice * (1 + 1 / leverage - margin)
      : position.entryPrice * (1 - 1 / leverage + margin);
    return isShort ? shockedPrice >= liquidation : shockedPrice <= liquidation;
  }
}
