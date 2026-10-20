/** A single open position held by a trader or liquidity provider. */
export interface Position {
  id: string;
  /** `CODE:ISSUER`, or `CODE` for the native asset. */
  asset: string;
  poolId?: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  /** Maintenance-margin rate, e.g. 0.05 for 5%. */
  liquidationThreshold?: number;
  /** Position leverage; 1 means unleveraged. */
  leverage?: number;
  /** Counterparty (pool, issuer or wallet) the exposure sits with. */
  counterparty?: string;
  /** True for liquidity-provider positions held in an AMM pool. */
  isLiquidityProvider?: boolean;
}

/** A point-in-time view of every position. */
export interface PortfolioSnapshot {
  positions: Position[];
  timestamp: Date;
}

export type VarMethod = 'historical' | 'parametric';

/** Value-at-Risk result for a portfolio. */
export interface VaRResult {
  /** Expected loss at the 95% confidence level, in quote currency. */
  valueAtRisk95: number;
  /** Expected loss at the 99% confidence level, in quote currency. */
  valueAtRisk99: number;
  method: VarMethod;
  sampleSize: number;
  computedAt: Date;
  durationMs: number;
}

/** How concentrated a portfolio is in a small number of exposures. */
export interface ConcentrationRisk {
  level: 'low' | 'medium' | 'high';
  /** Share of the portfolio held by the single largest exposure (0..1). */
  topAssetShare: number;
  /** Herfindahl index of asset weights (0..1). */
  herfindahlIndex: number;
  /** Human-readable descriptions of every breached limit. */
  breaches: string[];
}

export type RiskAlertSeverity = 'info' | 'warning' | 'critical';

export interface RiskAlert {
  id: string;
  severity: RiskAlertSeverity;
  type: string;
  message: string;
  positionId?: string;
  metadata: Record<string, unknown>;
  raisedAt: Date;
}

/** Aggregated real-time risk metrics for a portfolio. */
export interface RiskMetrics {
  portfolioValue: number;
  var95: number;
  var99: number;
  concentration: ConcentrationRisk;
  /** 0 (very liquid) → 1 (very illiquid). */
  liquidityRisk: number;
  largestExposure: number;
  counterpartyCount: number;
  computedAt: Date;
}

/** Liquidation risk for a single leveraged position. */
export interface LiquidationRisk {
  positionId: string;
  currentPrice: number;
  liquidationPrice: number;
  /** Percentage drop from the current price to the liquidation price. */
  distanceToLiquidation: number;
  atRisk: boolean;
  /** How many hops away this position is from a currently liquidating one. */
  cascadeDepth: number;
}

/** A market shock used by the stress-testing framework. */
export interface StressScenario {
  id: string;
  name: string;
  /** Price shock applied to every position, e.g. -0.5 for a 50% crash. */
  priceShock: number;
  /** Liquidity shock, e.g. -0.9 removes 90% of the available depth. */
  liquidityShock?: number;
  /** Credit shock applied to one counterparty. */
  counterpartyShock?: string;
  description?: string;
}

/** Outcome of running a stress scenario against a portfolio. */
export interface StressResult {
  scenarioId: string;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  loss: number;
  lossPercent: number;
  /** Positions that would be liquidated under the scenario. */
  marginCalls: string[];
  breaches: string[];
  computedAt: Date;
}

/** A daily risk summary suitable for reporting. */
export interface RiskReport {
  generatedAt: Date;
  metrics: RiskMetrics;
  positionCount: number;
  alerts: RiskAlert[];
  topCounterparties: Array<{ counterparty: string; exposure: number; share: number }>;
}

/** A point in a portfolio risk trend. */
export interface RiskTrendPoint {
  timestamp: Date;
  portfolioValue: number;
  var95: number;
  var99: number;
}

/** Risk metrics compared against a peer group. */
export interface RiskBenchmark {
  subject: RiskMetrics;
  peerAverage: {
    var95: number;
    var99: number;
    concentration: number;
  };
  percentile: number;
}
