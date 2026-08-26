import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum MetricType {
  // Trading metrics
  TRADE_VOLUME = 'trade_volume',
  TRADE_COUNT = 'trade_count',
  TRADE_VOLUME_BY_PAIR = 'trade_volume_by_pair',
  TRADE_VOLUME_BY_TRADER = 'trade_volume_by_trader',
  ORDER_FLOW = 'order_flow',
  ORDER_BOOK_DEPTH = 'order_book_depth',

  // Price metrics
  PRICE_ACTION = 'price_action',
  PRICE_VOLATILITY = 'price_volatility',
  PRICE_HIGH = 'price_high',
  PRICE_LOW = 'price_low',
  PRICE_OPEN = 'price_open',
  PRICE_CLOSE = 'price_close',

  // User metrics
  USER_ACTIVE = 'user_active',
  USER_NEW = 'user_new',
  USER_RETENTION = 'user_retention',
  USER_CHURN = 'user_churn',
  TRADER_PNL = 'trader_pnl',
  TRADER_WIN_RATE = 'trader_win_rate',
  TRADER_SHARPE_RATIO = 'trader_sharpe_ratio',

  // Pool/Liquidity metrics
  POOL_TVL = 'pool_tvl',
  POOL_UTILIZATION = 'pool_utilization',
  POOL_FEE_REVENUE = 'pool_fee_revenue',
  LP_RETURNS = 'lp_returns',
  IMPERMANENT_LOSS = 'impermanent_loss',

  // Revenue metrics
  REVENUE = 'revenue',
  REVENUE_FEES = 'revenue_fees',
  REVENUE_SPREADS = 'revenue_spreads',
  TRANSACTION_FEE = 'transaction_fee',
  COST_GAS = 'cost_gas',
  COST_OPERATIONS = 'cost_operations',
  PROFITABILITY = 'profitability',

  // System metrics
  SYSTEM_LATENCY = 'system_latency',
  BLOCKCHAIN_GAS = 'blockchain_gas',
  SETTLEMENT_TIME = 'settlement_time',
  ERROR_RATE = 'error_rate',

  // Anomaly detection
  ANOMALY_WASH_TRADING = 'anomaly_wash_trading',
  ANOMALY_MANIPULATION = 'anomaly_manipulation',
  ANOMALY_SUSPICIOUS_VOLUME = 'anomaly_suspicious_volume',
}

export enum MetricAggregation {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

@Entity('analytics_metrics')
@Index(['metricType', 'aggregation', 'timestamp'], { unique: true })
export class AnalyticsMetric extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  metricType: MetricType;

  @Column({ type: 'varchar', length: 20 })
  aggregation: MetricAggregation;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  value: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, string>;

  @Column({ type: 'varchar', nullable: true })
  assetCode?: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string;

  @Column({ type: 'varchar', nullable: true })
  userId?: string;

  @Column({ type: 'varchar', nullable: true })
  source?: string;

  @Column({ type: 'varchar', nullable: true })
  poolId?: string;

  @Column({ type: 'varchar', nullable: true })
  pairCode?: string;

  @Column({ type: 'varchar', nullable: true })
  traderId?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}