import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual, Between } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { QueryMetricsDto } from '../dto/query-metrics.dto';
import { PaginatedResultDto } from '@app/common';

@Injectable()
export class MetricsQueryService {
  private readonly logger = new Logger(MetricsQueryService.name);

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
  ) {}

  async queryMetrics(queryDto: QueryMetricsDto): Promise<PaginatedResultDto<AnalyticsMetric>> {
    const { page = 1, limit = 50, metricType, aggregation, dateFrom, dateTo, assetCodes, userId, dimensions } = queryDto;
    
    const queryBuilder = this.analyticsMetricRepository.createQueryBuilder('metric');
    
    queryBuilder.where('metric.timestamp BETWEEN :dateFrom AND :dateTo', {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });

    if (metricType) {
      queryBuilder.andWhere('metric.metricType = :metricType', { metricType });
    }

    if (aggregation) {
      queryBuilder.andWhere('metric.aggregation = :aggregation', { aggregation });
    }

    if (assetCodes && assetCodes.length > 0) {
      queryBuilder.andWhere('metric.assetCode IN (:...assetCodes)', { assetCodes });
    }

    if (userId) {
      queryBuilder.andWhere('metric.userId = :userId', { userId });
    }

    if (dimensions && dimensions.length > 0) {
      dimensions.forEach((dim, index) => {
        queryBuilder.andWhere(`metric.dimensions->>:${index} IS NOT NULL`, [dim]);
      });
    }

    queryBuilder.orderBy('metric.timestamp', 'DESC');
    queryBuilder.skip((page - 1) * limit);
    queryBuilder.take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return new PaginatedResultDto(
      data,
      total,
      page,
      limit
    );
  }

  async getTimeSeriesData(
    metricType: MetricType,
    aggregation: MetricAggregation,
    dateFrom: Date,
    dateTo: Date,
    assetCode?: string,
  ): Promise<{ timestamp: Date; value: string; [key: string]: any }[]> {
    const startTime = Date.now();
    
    const queryBuilder = this.analyticsMetricRepository.createQueryBuilder('metric');
    
    queryBuilder
      .select(['metric.timestamp', 'metric.value', 'metric.assetCode', 'metric.dimensions'])
      .where('metric.metricType = :metricType', { metricType })
      .andWhere('metric.aggregation = :aggregation', { aggregation })
      .andWhere('metric.timestamp BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });

    if (assetCode) {
      queryBuilder.andWhere('metric.assetCode = :assetCode', { assetCode });
    }

    queryBuilder.orderBy('metric.timestamp', 'ASC');

    const metrics = await queryBuilder.getMany();
    
    const executionTime = Date.now() - startTime;
    this.logger.debug(`Time series query executed in ${executionTime}ms`);
    
    if (executionTime > 5000) {
      this.logger.warn(`Query exceeded 5s threshold: ${executionTime}ms`);
    }

    return metrics.map(m => ({
      timestamp: m.timestamp,
      value: m.value,
      assetCode: m.assetCode,
      ...(m.dimensions || {}),
    }));
  }

  async getAggregatedMetrics(
    dateFrom: Date,
    dateTo: Date,
    metrics: MetricType[],
    aggregation: MetricAggregation = MetricAggregation.DAY,
  ): Promise<Record<string, any>> {
    const startTime = Date.now();
    
    const queryBuilder = this.analyticsMetricRepository
      .createQueryBuilder('metric')
      .where('metric.metricType IN (:...metrics)', { metrics })
      .andWhere('metric.aggregation = :aggregation', { aggregation })
      .andWhere('metric.timestamp BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });

    const results = await queryBuilder.getMany();
    
    const aggregated: Record<string, any> = {};
    
    for (const metric of results) {
      if (!aggregated[metric.metricType]) {
        aggregated[metric.metricType] = {
          values: [],
          sum: 0,
          avg: 0,
          min: Infinity,
          max: -Infinity,
        };
      }
      
      const value = parseFloat(metric.value);
      aggregated[metric.metricType].values.push({
        timestamp: metric.timestamp,
        value: metric.value,
      });
      aggregated[metric.metricType].sum += value;
      aggregated[metric.metricType].min = Math.min(aggregated[metric.metricType].min, value);
      aggregated[metric.metricType].max = Math.max(aggregated[metric.metricType].max, value);
    }

    for (const key of Object.keys(aggregated)) {
      const count = aggregated[key].values.length;
      aggregated[key].avg = count > 0 ? aggregated[key].sum / count : 0;
    }

    const executionTime = Date.now() - startTime;
    this.logger.debug(`Aggregated metrics query executed in ${executionTime}ms`);

    return aggregated;
  }

  async getDashboardSummary(): Promise<Record<string, any>> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const todayMetrics = await this.getAggregatedMetrics(
      today,
      now,
      [MetricType.TRADE_VOLUME, MetricType.TRADE_COUNT, MetricType.USER_ACTIVE, MetricType.REVENUE],
      MetricAggregation.DAY
    );

    const yesterdayMetrics = await this.getAggregatedMetrics(
      yesterday,
      today,
      [MetricType.TRADE_VOLUME, MetricType.TRADE_COUNT, MetricType.USER_ACTIVE, MetricType.REVENUE],
      MetricAggregation.DAY
    );

    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      currentDay: {
        tradeVolume: parseFloat(todayMetrics[MetricType.TRADE_VOLUME]?.sum || '0'),
        tradeCount: parseInt(todayMetrics[MetricType.TRADE_COUNT]?.sum || '0'),
        activeUsers: parseInt(todayMetrics[MetricType.USER_ACTIVE]?.sum || '0'),
        revenue: parseFloat(todayMetrics[MetricType.REVENUE]?.sum || '0'),
      },
      previousDay: {
        tradeVolume: parseFloat(yesterdayMetrics[MetricType.TRADE_VOLUME]?.sum || '0'),
        tradeCount: parseInt(yesterdayMetrics[MetricType.TRADE_COUNT]?.sum || '0'),
        activeUsers: parseInt(yesterdayMetrics[MetricType.USER_ACTIVE]?.sum || '0'),
        revenue: parseFloat(yesterdayMetrics[MetricType.REVENUE]?.sum || '0'),
      },
      changes: {
        tradeVolumePercent: calculateChange(
          parseFloat(todayMetrics[MetricType.TRADE_VOLUME]?.sum || '0'),
          parseFloat(yesterdayMetrics[MetricType.TRADE_VOLUME]?.sum || '0')
        ),
        tradeCountPercent: calculateChange(
          parseInt(todayMetrics[MetricType.TRADE_COUNT]?.sum || '0'),
          parseInt(yesterdayMetrics[MetricType.TRADE_COUNT]?.sum || '0')
        ),
        activeUsersPercent: calculateChange(
          parseInt(todayMetrics[MetricType.USER_ACTIVE]?.sum || '0'),
          parseInt(yesterdayMetrics[MetricType.USER_ACTIVE]?.sum || '0')
        ),
        revenuePercent: calculateChange(
          parseFloat(todayMetrics[MetricType.REVENUE]?.sum || '0'),
          parseFloat(yesterdayMetrics[MetricType.REVENUE]?.sum || '0')
        ),
      },
      lastUpdated: new Date(),
    };
  }

  async getHistoricalTrends(
    metricType: MetricType,
    months: number = 12,
    assetCode?: string,
  ): Promise<{ timestamp: Date; value: string; [key: string]: any }[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    return this.getTimeSeriesData(
      metricType,
      MetricAggregation.MONTH,
      startDate,
      endDate,
      assetCode
    );
  }
}