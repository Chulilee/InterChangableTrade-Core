import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
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

    const currentTvl = tvlMetrics.length > 0 ? parseFloat(tvlMetrics[0].value) : 0;
    const tvl24hAgo = this.findValueAtOffset(tvlMetrics, 24); // Approximate hourly data
    const tvl7dAgo = this.findValueAtOffset(tvlMetrics, 168); // 7 days hourly

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
    const utilization = currentTvl > 0 ? (tradingVolume24h / currentTvl) * 100 : 0;
    const feeApr = currentTvl > 0 ? (feeRevenue7d / currentTvl) * (365 / 7) * 100 : 0;

    // Get LP count
    const lpMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.LP_RETURNS,
        poolId,
        timestamp: Between(dateFrom, dateTo),
      },
    });

    const uniqueLps = new Set(lpMetrics.map(m => m.userId)).size;
    const avgLpDeposit = uniqueLps > 0 ? currentTvl / uniqueLps : 0;

    return {
      poolId,
      assetCode: tvlMetrics[0]?.assetCode ?? '',
      assetIssuer: tvlMetrics[0]?.assetIssuer ?? null,
      tvl: currentTvl,
      tvlChange24h: tvl24hAgo > 0 ? ((currentTvl - tvl24hAgo) / tvl24hAgo) * 100 : 0,
      tvlChange7d: tvl7dAgo > 0 ? ((currentTvl - tvl7dAgo) / tvl7dAgo) * 100 : 0,
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
    const returnPercent = initialValue > 0 ? (totalReturn / initialValue) * 100 : 0;

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
    const volumeByBucket = this.groupMetricsByBucket(volumeMetrics, aggregation);

    const result: PoolFeeAnalysis[] = [];
    let cumulativeFees = 0;

    for (const [bucket, fees] of feeByBucket) {
      const volumeMetricsInBucket = volumeByBucket.get(bucket) ?? [];
      const volume = volumeMetricsInBucket.reduce((sum, m) => sum + parseFloat(m.value), 0);
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
      const currentTvl = values.reduce((sum, m) => sum + parseFloat(m.value), 0) / values.length;
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

    const utilizations = utilizationMetrics.map(m => parseFloat(m.value));
    const avg = utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length;

    return {
      avgUtilization: avg,
      maxUtilization: Math.max(...utilizations),
      minUtilization: Math.min(...utilizations),
      utilizationTrend: utilizationMetrics.map(m => ({
        timestamp: m.timestamp,
        utilization: parseFloat(m.value),
      })),
    };
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  private findValueAtOffset(metrics: AnalyticsMetric[], hoursOffset: number): number {
    if (metrics.length === 0) return 0;
    
    const targetTime = new Date(metrics[0].timestamp);
    targetTime.setHours(targetTime.getHours() + hoursOffset);
    
    const closest = metrics.find(m => 
      Math.abs(m.timestamp.getTime() - targetTime.getTime()) < 3600000 // Within 1 hour
    );
    
    return closest ? parseFloat(closest.value) : 0;
  }

  private sumLastNHours(metrics: AnalyticsMetric[], hours: number): number {
    if (metrics.length === 0) return 0;
    
    const cutoff = new Date(metrics[metrics.length - 1].timestamp);
    cutoff.setHours(cutoff.getHours() - hours);
    
    return metrics
      .filter(m => m.timestamp >= cutoff)
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
