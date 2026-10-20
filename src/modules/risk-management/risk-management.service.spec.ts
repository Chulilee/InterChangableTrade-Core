import { Position } from './interfaces/risk.types';
import { LiquidationRiskService } from './services/liquidation-risk.service';
import { PositionMonitorService } from './services/position-monitor.service';
import { RiskReportingService } from './services/risk-reporting.service';
import { StressTestingService } from './services/stress-testing.service';
import { ValueAtRiskService } from './services/value-at-risk.service';

describe('Risk management engine', () => {
  let varService: ValueAtRiskService;
  let monitor: PositionMonitorService;
  let liquidation: LiquidationRiskService;
  let stress: StressTestingService;
  let reporting: RiskReportingService;

  const position = (overrides: Partial<Position> = {}): Position => ({
    id: 'p-1',
    asset: 'USDC:GA5Z',
    quantity: 1_000,
    entryPrice: 1,
    currentPrice: 1,
    ...overrides,
  });

  beforeEach(() => {
    varService = new ValueAtRiskService();
    monitor = new PositionMonitorService();
    liquidation = new LiquidationRiskService();
    stress = new StressTestingService();
    reporting = new RiskReportingService();
  });

  describe('value at risk', () => {
    it('computes a historical VaR at 95% and 99%', () => {
      const returns = [-0.05, -0.03, -0.01, 0.01, 0.02, -0.07, 0.04, -0.02];
      const result = varService.calculate(
        [position()],
        { 'USDC:GA5Z': returns },
        'historical',
      );

      expect(result.sampleSize).toBe(returns.length);
      expect(result.valueAtRisk95).toBeGreaterThan(0);
      expect(result.valueAtRisk99).toBeGreaterThanOrEqual(result.valueAtRisk95);
    });

    it('computes a parametric VaR', () => {
      const returns = [-0.05, -0.03, -0.01, 0.01, 0.02, -0.07, 0.04, -0.02];
      const result = varService.calculate(
        [position()],
        { 'USDC:GA5Z': returns },
        'parametric',
      );

      expect(result.method).toBe('parametric');
      expect(result.valueAtRisk99).toBeGreaterThan(0);
    });

    it('calculates VaR for a portfolio of 100+ assets within 500ms', () => {
      const positions: Position[] = [];
      const returnsByAsset: Record<string, number[]> = {};
      for (let i = 0; i < 120; i++) {
        const asset = `ASSET${i}:ISSUER${i}`;
        positions.push(position({ id: `p-${i}`, asset }));
        returnsByAsset[asset] = Array.from(
          { length: 50 },
          (_, j) => Math.sin(i + j) * 0.02,
        );
      }

      const result = varService.calculate(positions, returnsByAsset);

      expect(result.durationMs).toBeLessThan(500);
      expect(result.valueAtRisk95).toBeGreaterThan(0);
    });

    it('computes unrealised PnL', () => {
      expect(
        varService.unrealizedPnl(
          position({ quantity: 10, entryPrice: 2, currentPrice: 3 }),
        ),
      ).toBeCloseTo(10);
    });
  });

  describe('position monitoring', () => {
    it('tracks portfolio value in real time', () => {
      monitor.upsertPosition(position({ quantity: 100, currentPrice: 2 }));
      monitor.upsertPosition(position({ id: 'p-2', quantity: 50, currentPrice: 4 }));

      expect(monitor.portfolioValue()).toBe(400);

      monitor.updatePrice('p-2', 8);
      expect(monitor.portfolioValue()).toBe(600);
    });

    it('detects concentration breaches', () => {
      monitor.upsertPosition(position({ quantity: 900, currentPrice: 1 }));
      monitor.upsertPosition(
        position({ id: 'p-2', asset: 'XLM', quantity: 100, currentPrice: 1 }),
      );

      const concentration = monitor.concentration({ maxAssetShare: 0.5 });

      expect(concentration.level).toBe('high');
      expect(concentration.breaches.length).toBeGreaterThan(0);
      expect(concentration.topAssetShare).toBeCloseTo(0.9);
    });

    it('raises alerts when a threshold is breached', () => {
      monitor.upsertPosition(position({ quantity: 900, currentPrice: 1 }));
      monitor.upsertPosition(
        position({ id: 'p-2', asset: 'XLM', quantity: 100, currentPrice: 1 }),
      );

      const alerts = monitor.evaluateThresholds({ maxAssetShare: 0.5 });

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some((alert) => alert.type === 'concentration')).toBe(true);
    });

    it('computes impermanent loss for a liquidity-provider position', () => {
      const il = monitor.impermanentLoss(
        position({
          isLiquidityProvider: true,
          entryPrice: 100,
          currentPrice: 400,
        }),
      );
      // 50/50 pool: value ratio = 2*sqrt(4)/(1+4) = 0.8 -> 20% IL.
      expect(il).toBeCloseTo(0.2, 5);
    });
  });

  describe('liquidation risk', () => {
    it('computes the liquidation price for a leveraged long', () => {
      const price = liquidation.liquidationPrice(
        position({
          entryPrice: 100,
          currentPrice: 100,
          leverage: 2,
          liquidationThreshold: 0.05,
        }),
      );
      // entry * (1 - 1/2 + 0.05) = 55
      expect(price).toBeCloseTo(55);
    });

    it('flags a position that is close to liquidation', () => {
      const risk = liquidation.assess(
        position({
          entryPrice: 100,
          currentPrice: 57,
          leverage: 2,
          liquidationThreshold: 0.05,
        }),
      );

      expect(risk.atRisk).toBe(true);
      expect(risk.distanceToLiquidation).toBeLessThan(10);
      expect(liquidation.recommendedActions(risk).length).toBeGreaterThan(0);
    });

    it('does not flag an unleveraged position', () => {
      const risk = liquidation.assess(position());
      expect(risk.atRisk).toBe(false);
    });

    it('detects a cascade through a shared pool', () => {
      const positions = [
        position({
          id: 'p-1',
          poolId: 'pool-1',
          entryPrice: 100,
          currentPrice: 57,
          leverage: 2,
          liquidationThreshold: 0.05,
        }),
        position({ id: 'p-2', poolId: 'pool-1', currentPrice: 1 }),
      ];
      const risks = liquidation.assessAll(positions);
      const groups = liquidation.detectCascade(risks, positions);

      expect(groups).toHaveLength(1);
      expect(groups[0].map((risk) => risk.positionId)).toContain('p-2');
      expect(groups[0].find((risk) => risk.positionId === 'p-2')?.cascadeDepth).toBe(1);
    });
  });

  describe('stress testing', () => {
    it('measures the loss under a market crash', () => {
      const positions = [position({ quantity: 100, currentPrice: 10 })];
      const result = stress.run(positions, {
        id: 'crash',
        name: '50% crash',
        priceShock: -0.5,
      });

      expect(result.portfolioValueBefore).toBe(1000);
      expect(result.portfolioValueAfter).toBe(500);
      expect(result.loss).toBe(500);
      expect(result.lossPercent).toBeCloseTo(50);
    });

    it('flags positions that would be liquidated', () => {
      const positions = [
        position({
          entryPrice: 100,
          currentPrice: 100,
          leverage: 2,
          liquidationThreshold: 0.05,
        }),
      ];
      const result = stress.run(positions, {
        id: 'crash',
        name: '80% crash',
        priceShock: -0.8,
      });

      expect(result.marginCalls).toContain('p-1');
    });

    it('models a liquidity crunch for LP positions', () => {
      const positions = [
        position({
          quantity: 100,
          currentPrice: 1,
          isLiquidityProvider: true,
        }),
      ];
      const result = stress.run(positions, {
        id: 'crunch',
        name: 'liquidity crunch',
        priceShock: 0,
        liquidityShock: -0.9,
      });

      expect(result.portfolioValueAfter).toBeCloseTo(10);
    });

    it('validates a model against a realised scenario', () => {
      const validation = stress.validateAgainstHistory(100, 90);
      expect(validation.absoluteError).toBe(10);
      expect(validation.percentageError).toBeCloseTo(11.11, 2);
    });
  });

  describe('risk reporting', () => {
    it('ranks counterparties by exposure', () => {
      const ranked = reporting.topCounterparties([
        { counterparty: 'a', exposure: 100 },
        { counterparty: 'b', exposure: 300 },
        { counterparty: 'c', exposure: 200 },
      ]);

      expect(ranked[0].counterparty).toBe('b');
      expect(ranked[0].share).toBeCloseTo(0.5);
    });

    it('benchmarks a portfolio against peers', () => {
      const metrics = {
        portfolioValue: 1000,
        var95: 10,
        var99: 20,
        concentration: {
          level: 'low' as const,
          topAssetShare: 0.2,
          herfindahlIndex: 0.2,
          breaches: [],
        },
        liquidityRisk: 0.1,
        largestExposure: 200,
        counterpartyCount: 2,
        computedAt: new Date(),
      };
      const peers = [
        { ...metrics, var99: 30 },
        { ...metrics, var99: 50 },
      ];

      const benchmark = reporting.benchmark(metrics, peers);

      expect(benchmark.percentile).toBe(100);
      expect(benchmark.peerAverage.var99).toBe(40);
    });
  });
});
