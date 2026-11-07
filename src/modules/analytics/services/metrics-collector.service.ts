import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { createHash } from 'crypto';
import {
  AnalyticsMetric,
  MetricType,
  MetricAggregation,
} from '../entities/analytics-metric.entity';
import { Trade } from '../../trading-engine/entities/trade.entity';
import { User } from '../../users/entities/user.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

/** Null-safe dimension tuple for a metric row. */
export interface MetricDimensions {
  assetCode?: string;
  assetIssuer?: string;
  userId?: string;
  source?: string;
}

/** Deterministic sha256 of the dimension tuple for the unique grain. */
export function computeDimensionHash(dimensions: MetricDimensions): string {
  const canonical = [
    dimensions.assetCode ?? '',
    dimensions.assetIssuer ?? '',
    dimensions.userId ?? '',
    dimensions.source ?? '',
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** True for Postgres unique-violation (23505) and equivalent messages. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as Record<string, unknown>;
  const code = String(
    err.code ?? (err.driverError as any)?.code ?? '',
  ).toUpperCase();
  if (code === '23505') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint/.test(message);
}

@Injectable()
export class MetricsCollectorService {
  private readonly logger = new Logger(MetricsCollectorService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  async recordMetric(
    metricType: MetricType,
    value: string,
    timestamp: Date = new Date(),
    dimensions?: Record<string, string>,
    assetCode?: string,
    assetIssuer?: string,
    userId?: string,
    source?: string,
  ): Promise<AnalyticsMetric> {
    const aggregations = this.getRelevantAggregations(timestamp);

    const metrics = await Promise.all(
      aggregations.map((aggregation) =>
        this.upsertMetric(
          metricType,
          aggregation,
          this.getAggregationTimestamp(timestamp, aggregation),
          value,
          dimensions,
          assetCode,
          assetIssuer,
          userId,
          source,
        ),
      ),
    );

    return metrics[0];
  }

  private async upsertMetric(
    metricType: MetricType,
    aggregation: MetricAggregation,
    timestamp: Date,
    value: string,
    dimensions?: Record<string, string>,
    assetCode?: string,
    assetIssuer?: string,
    userId?: string,
    source?: string,
  ): Promise<AnalyticsMetric> {
    // Identity is (metricType, aggregation, timestamp, dimensionHash); the
    // hash makes null dimensions comparable. Keep in sync with the entity.
    const dimensionHash = computeDimensionHash({
      assetCode,
      assetIssuer,
      userId,
      source,
    });
    const whereClause = {
      metricType,
      aggregation,
      timestamp,
      dimensionHash,
    };

    const existingMetric = await this.analyticsMetricRepository.findOne({
      where: whereClause,
    });

    if (existingMetric) {
      return this.updateMetricValue(existingMetric, value, metricType);
    }

    const newMetric = this.analyticsMetricRepository.create({
      metricType,
      aggregation,
      timestamp,
      value,
      dimensions,
      assetCode,
      assetIssuer,
      userId,
      source,
      dimensionHash,
    });

    try {
      return await this.analyticsMetricRepository.save(newMetric);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Concurrent collector won the insert; converge to an update.
      this.logger.warn(
        `Unique violation on metric upsert for ${metricType}/${aggregation}/${timestamp.toISOString()}; retrying as update`,
      );
      const winner = await this.analyticsMetricRepository.findOne({
        where: whereClause,
      });
      if (!winner) {
        throw error;
      }
      return this.updateMetricValue(winner, value, metricType);
    }
  }

  private async updateMetricValue(
    metric: AnalyticsMetric,
    value: string,
    metricType: MetricType,
  ): Promise<AnalyticsMetric> {
    const newValue = this.aggregateValues(metric.value, value, metricType);
    metric.value = newValue;
    return this.analyticsMetricRepository.save(metric);
  }

  private aggregateValues(
    existingValue: string,
    newValue: string,
    metricType: MetricType,
  ): string {
    const existing = parseFloat(existingValue);
    const current = parseFloat(newValue);

    switch (metricType) {
      case MetricType.TRADE_VOLUME:
      case MetricType.TRADE_COUNT:
      case MetricType.REVENUE:
      case MetricType.TRANSACTION_FEE:
      case MetricType.USER_NEW:
      case MetricType.BLOCKCHAIN_GAS:
        return (existing + current).toString();
      case MetricType.SYSTEM_LATENCY:
      case MetricType.SETTLEMENT_TIME:
        return ((existing + current) / 2).toString();
      case MetricType.ERROR_RATE:
        return current.toString();
      case MetricType.USER_ACTIVE:
        return existing.toString();
      default:
        return newValue;
    }
  }

  private getRelevantAggregations(timestamp: Date): MetricAggregation[] {
    return [
      MetricAggregation.MINUTE,
      MetricAggregation.HOUR,
      MetricAggregation.DAY,
      MetricAggregation.WEEK,
      MetricAggregation.MONTH,
    ];
  }

  private getAggregationTimestamp(
    timestamp: Date,
    aggregation: MetricAggregation,
  ): Date {
    const date = new Date(timestamp);

    switch (aggregation) {
      case MetricAggregation.MINUTE:
        date.setSeconds(0, 0);
        break;
      case MetricAggregation.HOUR:
        date.setMinutes(0, 0, 0);
        break;
      case MetricAggregation.DAY:
        date.setHours(0, 0, 0, 0);
        break;
      case MetricAggregation.WEEK:
        const day = date.getDay();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - day);
        break;
      case MetricAggregation.MONTH:
        date.setDate(1);
        date.setHours(0, 0, 0, 0);
        break;
    }

    return date;
  }

  async calculateTradeMetrics(dateFrom: Date, dateTo: Date): Promise<void> {
    this.logger.log(
      `Calculating trade metrics from ${dateFrom.toISOString()} to ${dateTo.toISOString()}`,
    );

    const trades = await this.tradeRepository.find({
      where: {
        createdAt: MoreThanOrEqual(dateFrom),
      },
    });

    const totalVolume = trades.reduce(
      (sum, trade) =>
        sum + parseFloat(trade.quantity) * parseFloat(trade.price),
      0,
    );
    const tradeCount = trades.length;
    const settledTrades = trades.filter((t) => t.settled);

    const avgSettlementTime =
      settledTrades.length > 0
        ? settledTrades.reduce((sum, trade) => {
            const settlementTime =
              trade.settledAt!.getTime() - trade.createdAt.getTime();
            return sum + settlementTime;
          }, 0) / settledTrades.length
        : 0;

    await this.recordMetric(
      MetricType.TRADE_VOLUME,
      totalVolume.toString(),
      new Date(),
    );
    await this.recordMetric(
      MetricType.TRADE_COUNT,
      tradeCount.toString(),
      new Date(),
    );
    await this.recordMetric(
      MetricType.SETTLEMENT_TIME,
      avgSettlementTime.toString(),
      new Date(),
    );

    this.logger.log(
      `Processed ${trades.length} trades, total volume: ${totalVolume}`,
    );
  }

  async calculateUserMetrics(dateFrom: Date, dateTo: Date): Promise<void> {
    this.logger.log(
      `Calculating user metrics from ${dateFrom.toISOString()} to ${dateTo.toISOString()}`,
    );

    const newUsers = await this.userRepository.count({
      where: {
        createdAt: MoreThanOrEqual(dateFrom),
      },
    });

    const activeUsers = await this.userRepository.count({
      where: {
        isActive: true,
      },
    });

    await this.recordMetric(
      MetricType.USER_NEW,
      newUsers.toString(),
      new Date(),
    );
    await this.recordMetric(
      MetricType.USER_ACTIVE,
      activeUsers.toString(),
      new Date(),
    );

    this.logger.log(`New users: ${newUsers}, Active users: ${activeUsers}`);
  }

  async calculateRevenueMetrics(dateFrom: Date, dateTo: Date): Promise<void> {
    this.logger.log(
      `Calculating revenue metrics from ${dateFrom.toISOString()} to ${dateTo.toISOString()}`,
    );

    const transactions = await this.transactionRepository.find({
      where: {
        createdAt: MoreThanOrEqual(dateFrom),
        // Removed duplicate createdAt key
      },
    });

    // Use transaction amount instead of missing fee field
    const totalAmount = transactions.reduce(
      (sum, tx) => sum + parseFloat(tx.amount || '0'),
      0,
    );

    await this.recordMetric(
      MetricType.TRANSACTION_FEE,
      totalAmount.toString(),
      new Date(),
    );
    await this.recordMetric(
      MetricType.REVENUE,
      totalAmount.toString(),
      new Date(),
    );

    this.logger.log(`Total transaction volume: ${totalAmount}`);
  }

  async cleanupOldData(retentionYears: number = 2): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - retentionYears);

    const deleteResult = await this.analyticsMetricRepository
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(
      `Cleaned up ${deleteResult.affected} old metric records older than ${retentionYears} years`,
    );
  }
}
