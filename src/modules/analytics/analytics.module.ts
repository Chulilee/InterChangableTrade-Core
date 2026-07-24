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
  ],
  exports: [
    MetricsCollectorService,
    MetricsQueryService,
  ],
})
export class AnalyticsModule {}