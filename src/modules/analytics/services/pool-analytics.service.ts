import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  AnalyticsMetric,
  MetricType,
  MetricAggregation,
} from '../entities/analytics-metric.entity';
import { Trade } from '../../trading-engine/entities/trade.entity';

export interface PoolMetrics {
  poolId: string;
  assetCode: string;
  assetIssuer: string | null;
  tvl: number;
  tvlChange24h: number;
  tvlChange7d: number;
  utilization: number;
  feeRevenue24h: number;
  feeRevenue7d: number;
  feeApr: number;
  tradingVolume24h: number;
  tradingVolume7d: number;
  uniqueLps: number;
  avgLpDeposit: number;
}

export interface LpReturnMetrics {
  lpId: string;
  poolId: string;
  depositDate: Date;
  initialValue: number;
  currentValue: number;
  totalReturn: number;
  returnPercent: number;
  feesEarned: number;
  impermanentLoss: number;
  netReturn: number;
}

export interface PoolFeeAnalysis {
  timestamp: Date;
  feesCollected: number;
  tradingVolume: number;
  feeRate: number;
  cumulativeFees: number;
}

export interface TvlTrend {
  timestamp: Date;
  tvl: number;
  change: number;
  changePercent: number;
}

/** Result of a look-back lookup on a metric series. */
export interface MetricValueAtOffset {
  /**
   * Value of the sample closest to the target time, or `null` when no sample
   * exists at that offset. `null` lets callers tell "no prior sample" apart
   * from "the prior sample was zero".
   */
  value: number | null;
  /** The matched sample, or `null` when there is no match. */
  sample: AnalyticsMetric | null;
  /** Target timestamp (`newest - hoursBack`), or `null` for an empty series. */
  targetTime: Date | null;
  /** True when the target predates the oldest sample in the series. */
  outOfRange: boolean;
}

/** A sample within this distance of the target counts as "at" the offset. */
const SAMPLE_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * Finds the metric value recorded `hoursBack` hours before the newest sample.
 *
 * Both the newest and the oldest samples are selected by timestamp rather than
 * array position, so the result does not depend on the query's ordering.
 * Returns `value: null` when no sample is close enough (or when the offset is
 * older than the available data), which keeps the percentage calculation from
 * dividing by zero.
 */
export function findValueAtOffset(
  metrics: readonly AnalyticsMetric[],
  hoursBack: number,
): MetricValueAtOffset {
  if (!Number.isFinite(hoursBack) || hoursBack < 0) {
    throw new RangeError('hoursBack must be a non-negative finite number');
  }

  if (metrics.length === 0) {
    return { value: null, sample: null, targetTime: null, outOfRange: false };
  }

  const ordered = [...metrics].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];

  const targetTime = new Date(newest.timestamp);
  targetTime.setHours(targetTime.getHours() - hoursBack);

  if (targetTime.getTime() < oldest.timestamp.getTime()) {
    return { value: null, sample: null, targetTime, outOfRange: true };
  }

  let closest: AnalyticsMetric | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const metric of ordered) {
    const distance = Math.abs(
      metric.timestamp.getTime() - targetTime.getTime(),
    );
    if (distance < closestDistance) {
      closest = metric;
      closestDistance = distance;
    }
  }

  if (!closest || closestDistance >= SAMPLE_TOLERANCE_MS) {
    return { value: null, sample: null, targetTime, outOfRange: false };
  }

  return {
    value: parseFloat(closest.value),
    sample: closest,
    targetTime,
    outOfRange: false,
  };
}

@Injectable()
export class PoolAnalyticsService {
  private readonly logger = new Logger(PoolAnalyticsService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
  ) {}

  /**
   * Get comprehensive pool metrics
   */
  async getPoolMetrics(
    poolId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<PoolMetrics> {
    // Get TVL data
    const tvlMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.POOL_TVL,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'DESC' },
    });

    const currentTvlSample = findValueAtOffset(tvlMetrics, 0);
    const currentTvl = currentTvlSample.value ?? 0;
    const tvl24hAgo = findValueAtOffset(tvlMetrics, 24);
    const tvl7dAgo = findValueAtOffset(tvlMetrics, 168);

    if (tvl24hAgo.outOfRange) {
      this.logger.debug(
        `Pool ${poolId}: no TVL sample at the 24h offset (older than available data)`,
      );
    }
    if (tvl7dAgo.outOfRange) {
      this.logger.debug(
        `Pool ${poolId}: no TVL sample at the 7d offset (older than available data)`,
      );
    }

    // Get fee revenue
    const feeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.POOL_FEE_REVENUE,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const feeRevenue24h = this.sumLastNHours(feeMetrics, 24);
    const feeRevenue7d = this.sumLastNHours(feeMetrics, 168);

    // Get trading volume
    const volumeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.TRADE_VOLUME,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const tradingVolume24h = this.sumLastNHours(volumeMetrics, 24);
    const tradingVolume7d = this.sumLastNHours(volumeMetrics, 168);

    // Calculate utilization and APR
    const utilization =
      currentTvl > 0 ? (tradingVolume24h / currentTvl) * 100 : 0;
    const feeApr =
      currentTvl > 0 ? (feeRevenue7d / currentTvl) * (365 / 7) * 100 : 0;

    // Get LP count
    const lpMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.LP_RETURNS,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
    });

    const uniqueLps = new Set(lpMetrics.map((m) => m.userId)).size;
    const avgLpDeposit = uniqueLps > 0 ? currentTvl / uniqueLps : 0;

    return {
      poolId,
      assetCode: currentTvlSample.sample?.assetCode ?? '',
      assetIssuer: currentTvlSample.sample?.assetIssuer ?? null,
      tvl: currentTvl,
      tvlChange24h: PoolAnalyticsService.percentChange(currentTvl, tvl24hAgo),
      tvlChange7d: PoolAnalyticsService.percentChange(currentTvl, tvl7dAgo),
      utilization,
      feeRevenue24h,
      feeRevenue7d,
      feeApr,
      tradingVolume24h,
      tradingVolume7d,
      uniqueLps,
      avgLpDeposit,
    };
  }

  /**
   * Get LP returns and impermanent loss tracking
   */
  async getLpReturns(
    lpId: string,
    poolId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<LpReturnMetrics> {
    const lpMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.LP_RETURNS,
        userId: lpId,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    if (lpMetrics.length === 0) {
      return {
        lpId,
        poolId,
        depositDate: dateFrom,
        initialValue: 0,
        currentValue: 0,
        totalReturn: 0,
        returnPercent: 0,
        feesEarned: 0,
        impermanentLoss: 0,
        netReturn: 0,
      };
    }

    const initialValue = parseFloat(lpMetrics[0].value);
    const currentValue = parseFloat(lpMetrics[lpMetrics.length - 1].value);
    const totalReturn = currentValue - initialValue;
    const returnPercent =
      initialValue > 0 ? (totalReturn / initialValue) * 100 : 0;

    // Calculate fees earned
    const feesEarned = lpMetrics.reduce(
      (sum, m) => sum + (m.metadata?.feesEarned ?? 0),
      0,
    );

    // Calculate impermanent loss
    const impermanentLoss = lpMetrics.reduce(
      (sum, m) => sum + (m.metadata?.impermanentLoss ?? 0),
      0,
    );

    const netReturn = totalReturn + feesEarned - impermanentLoss;

    return {
      lpId,
      poolId,
      depositDate: lpMetrics[0].timestamp,
      initialValue,
      currentValue,
      totalReturn,
      returnPercent,
      feesEarned,
      impermanentLoss,
      netReturn,
    };
  }

  /**
   * Get fee collection analysis over time
   */
  async getFeeCollectionAnalysis(
    poolId: string,
    dateFrom: Date,
    dateTo: Date,
    aggregation: MetricAggregation = MetricAggregation.DAY,
  ): Promise<PoolFeeAnalysis[]> {
    const feeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.POOL_FEE_REVENUE,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const volumeMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.TRADE_VOLUME,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    // Group by time bucket
    const feeByBucket = this.groupMetricsByBucket(feeMetrics, aggregation);
    const volumeByBucket = this.groupMetricsByBucket(
      volumeMetrics,
      aggregation,
    );

    const result: PoolFeeAnalysis[] = [];
    let cumulativeFees = 0;

    for (const [bucket, fees] of feeByBucket) {
      const volumeMetricsInBucket = volumeByBucket.get(bucket) ?? [];
      const volume = volumeMetricsInBucket.reduce(
        (sum, m) => sum + parseFloat(m.value),
        0,
      );
      const totalFees = fees.reduce((sum, m) => sum + parseFloat(m.value), 0);
      const feeRate = volume > 0 ? (totalFees / volume) * 100 : 0;
      cumulativeFees += totalFees;

      result.push({
        timestamp: new Date(bucket),
        feesCollected: totalFees,
        tradingVolume: volume,
        feeRate,
        cumulativeFees,
      });
    }

    return result;
  }

  /**
   * Get TVL trends and forecasts
   */
  async getTvlTrends(
    poolId: string,
    dateFrom: Date,
    dateTo: Date,
    aggregation: MetricAggregation = MetricAggregation.DAY,
  ): Promise<TvlTrend[]> {
    const tvlMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.POOL_TVL,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const tvlByBucket = this.groupMetricsByBucket(tvlMetrics, aggregation);

    const trends: TvlTrend[] = [];
    let previousTvl = 0;

    for (const [bucket, values] of tvlByBucket) {
      const currentTvl =
        values.reduce((sum, m) => sum + parseFloat(m.value), 0) / values.length;
      const change = currentTvl - previousTvl;
      const changePercent = previousTvl > 0 ? (change / previousTvl) * 100 : 0;

      trends.push({
        timestamp: new Date(bucket),
        tvl: currentTvl,
        change,
        changePercent,
      });

      previousTvl = currentTvl;
    }

    return trends;
  }

  /**
   * Compare multiple pools
   */
  async comparePools(
    poolIds: string[],
    dateFrom: Date,
    dateTo: Date,
  ): Promise<Array<PoolMetrics & { rank: number }>> {
    const metrics: Array<PoolMetrics & { rank: number }> = [];

    for (const poolId of poolIds) {
      try {
        const poolMetrics = await this.getPoolMetrics(poolId, dateFrom, dateTo);
        metrics.push({ ...poolMetrics, rank: 0 });
      } catch (error) {
        this.logger.warn(`Failed to get metrics for pool ${poolId}`);
      }
    }

    // Rank by TVL
    metrics.sort((a, b) => b.tvl - a.tvl);
    metrics.forEach((m, i) => {
      m.rank = i + 1;
    });

    return metrics;
  }

  /**
   * Get pool utilization metrics
   */
  async getPoolUtilization(
    poolId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<{
    avgUtilization: number;
    maxUtilization: number;
    minUtilization: number;
    utilizationTrend: Array<{ timestamp: Date; utilization: number }>;
  }> {
    const utilizationMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.POOL_UTILIZATION,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    if (utilizationMetrics.length === 0) {
      return {
        avgUtilization: 0,
        maxUtilization: 0,
        minUtilization: 0,
        utilizationTrend: [],
      };
    }

    const utilizations = utilizationMetrics.map((m) => parseFloat(m.value));
    const avg =
      utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length;

    return {
      avgUtilization: avg,
      maxUtilization: Math.max(...utilizations),
      minUtilization: Math.min(...utilizations),
      utilizationTrend: utilizationMetrics.map((m) => ({
        timestamp: m.timestamp,
        utilization: parseFloat(m.value),
      })),
    };
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  /**
   * Percent change from `previous` to `current`.
   *
   * Returns 0 when there is no prior sample (`null`) or the prior value was
   * zero — neither has a meaningful percentage change, and this also keeps the
   * division safe.
   */
  private static percentChange(
    current: number,
    previous: MetricValueAtOffset,
  ): number {
    if (previous.value === null || previous.value === 0) {
      return 0;
    }
    return ((current - previous.value) / previous.value) * 100;
  }

  private sumLastNHours(metrics: AnalyticsMetric[], hours: number): number {
    if (metrics.length === 0) return 0;

    const cutoff = new Date(metrics[metrics.length - 1].timestamp);
    cutoff.setHours(cutoff.getHours() - hours);

    return metrics
      .filter((m) => m.timestamp >= cutoff)
      .reduce((sum, m) => sum + parseFloat(m.value), 0);
  }

  private groupMetricsByBucket(
    metrics: AnalyticsMetric[],
    aggregation: MetricAggregation,
  ): Map<string, AnalyticsMetric[]> {
    const buckets = new Map<string, AnalyticsMetric[]>();

    for (const metric of metrics) {
      const bucketKey = this.getBucketKey(metric.timestamp, aggregation);
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(metric);
    }

    return buckets;
  }

  private getBucketKey(date: Date, aggregation: MetricAggregation): string {
    const d = new Date(date);

    switch (aggregation) {
      case MetricAggregation.MINUTE:
        d.setSeconds(0, 0);
        break;
      case MetricAggregation.HOUR:
        d.setMinutes(0, 0, 0);
        break;
      case MetricAggregation.DAY:
        d.setHours(0, 0, 0, 0);
        break;
      case MetricAggregation.WEEK: {
        const day = d.getDay();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - day);
        break;
      }
      case MetricAggregation.MONTH:
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        break;
    }

    return d.toISOString();
  }
}
