import { Injectable } from '@nestjs/common';
import { LiquidationRisk, Position } from '../interfaces/risk.types';

/**
 * Detects liquidation risk for leveraged positions.
 *
 * For an isolated-margin long with leverage `L` and maintenance margin rate
 * `m`, the liquidation price is `entry * (1 - 1/L + m)`. Short positions use
 * the mirrored formula.
 */
@Injectable()
export class LiquidationRiskService {
  /** Price at which the position would be liquidated. */
  liquidationPrice(position: Position): number | undefined {
    const leverage = position.leverage ?? 1;
    if (leverage <= 1) return undefined;

    const margin = position.liquidationThreshold ?? 0.05;
    const isShort = position.quantity < 0;

    const price = isShort
      ? position.entryPrice * (1 + 1 / leverage - margin)
      : position.entryPrice * (1 - 1 / leverage + margin);

    return Math.max(0, price);
  }

  /** Assesses the liquidation risk of a single position. */
  assess(position: Position): LiquidationRisk {
    const liquidation = this.liquidationPrice(position);
    const current = position.currentPrice;

    if (liquidation === undefined) {
      return {
        positionId: position.id,
        currentPrice: current,
        liquidationPrice: current,
        distanceToLiquidation: 100,
        atRisk: false,
        cascadeDepth: 0,
      };
    }

    const distanceToLiquidation =
      current === 0 ? 100 : ((current - liquidation) / current) * 100;

    return {
      positionId: position.id,
      currentPrice: current,
      liquidationPrice: liquidation,
      distanceToLiquidation,
      atRisk: distanceToLiquidation <= 10,
      cascadeDepth: 0,
    };
  }

  /** Assesses every position in the portfolio. */
  assessAll(positions: Position[]): LiquidationRisk[] {
    return positions.map((position) => this.assess(position));
  }

  /**
   * Detects cascading liquidations.
   *
   * Positions sharing a pool are exposed to each other, and positions sharing
   * a counterparty are exposed one hop further out. The returned groups are
   * ordered by cascade depth.
   */
  detectCascade(
    risks: LiquidationRisk[],
    positions: Position[],
  ): LiquidationRisk[][] {
    const byId = new Map(positions.map((position) => [position.id, position]));
    const atRisk = risks.filter((risk) => risk.atRisk);
    if (atRisk.length === 0) return [];

    const groups: LiquidationRisk[][] = [];
    const seen = new Set<string>();

    for (const risk of atRisk) {
      if (seen.has(risk.positionId)) continue;
      const group: LiquidationRisk[] = [];

      const seed = byId.get(risk.positionId);
      const poolMembers = seed?.poolId
        ? positions.filter(
            (position) =>
              position.poolId === seed.poolId && position.id !== seed.id,
          )
        : [];

      for (const member of poolMembers) {
        const memberRisk = risks.find((r) => r.positionId === member.id);
        if (!memberRisk || seen.has(member.id)) continue;
        group.push({ ...memberRisk, cascadeDepth: 1 });
        seen.add(member.id);
      }

      const counterpartyMembers = seed?.counterparty
        ? positions.filter(
            (position) =>
              position.counterparty === seed.counterparty &&
              position.id !== seed.id &&
              !poolMembers.some((member) => member.id === position.id),
          )
        : [];
      for (const member of counterpartyMembers) {
        const memberRisk = risks.find((r) => r.positionId === member.id);
        if (!memberRisk || seen.has(member.id)) continue;
        group.push({ ...memberRisk, cascadeDepth: 2 });
        seen.add(member.id);
      }

      group.unshift({ ...risk, cascadeDepth: 0 });
      seen.add(risk.positionId);
      groups.push(group);
    }

    return groups;
  }

  /**
   * Preventive actions to take for a position that is close to liquidation.
   */
  recommendedActions(risk: LiquidationRisk): string[] {
    if (!risk.atRisk) return [];
    const actions = [
      'Reduce position size to lower the liquidation price',
      'Add collateral to widen the maintenance margin',
    ];
    if (risk.distanceToLiquidation <= 0) {
      actions.unshift('Position is already past its liquidation price — settle now');
    }
    if (risk.cascadeDepth > 0) {
      actions.push(
        'Check correlated positions — the same pool or counterparty is also at risk',
      );
    }
    return actions;
  }
}
