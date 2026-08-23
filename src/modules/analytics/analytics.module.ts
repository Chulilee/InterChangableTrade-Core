import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsMetric } from './entities/analytics-metric.entity';
import { SavedReport } from './entities/saved-report.entity';
import { UserSegment } from './entities/user-segment.entity';
import { AnalyticsController } from './analytics.controller';
import { MetricsCollectorService } from './services/metrics-collector.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { UserSegmentationService } from './services/user-segmentation.service';
import { MetricsQueryService } from './services/metrics-query.service';
import { MarketAnalyticsService } from './services/market-analytics.service';
import { TraderPerformanceService } from './services/trader-performance.service';
import { PoolAnalyticsService } from './services/pool-analytics.service';
import { FinancialReportingService } from './services/financial-reporting.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { ScheduledReportService } from './services/scheduled-report.service';
import { DataPipelineService } from './services/data-pipeline.service';
import { Trade } from '../trading-engine/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { Transaction } from '../transactions/entities/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalyticsMetric,
      SavedReport,
      UserSegment,
      Trade,
      User,
      Transaction,
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [
    MetricsCollectorService,
    ReportGeneratorService,
    UserSegmentationService,
    MetricsQueryService,
    MarketAnalyticsService,
    TraderPerformanceService,
    PoolAnalyticsService,
    FinancialReportingService,
    AnomalyDetectionService,
    ScheduledReportService,
    DataPipelineService,
  ],
  exports: [
    MetricsCollectorService,
    MetricsQueryService,
    MarketAnalyticsService,
    TraderPerformanceService,
    PoolAnalyticsService,
    FinancialReportingService,
    AnomalyDetectionService,
    ScheduledReportService,
    DataPipelineService,
  ],
})
export class AnalyticsModule {}
