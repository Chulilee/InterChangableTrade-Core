import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputeMessage } from './entities/dispute-message.entity';
import { DisputeTimeline } from './entities/dispute-timeline.entity';
import { Arbitrator } from './entities/arbitrator.entity';
import { DisputeResolutionService } from './dispute-resolution.service';
import { DisputeResolutionController } from './dispute-resolution.controller';
import { DisputeEvidenceService } from './services/dispute-evidence.service';
import { ArbitratorService } from './services/arbitrator.service';
import { DisputePatternDetectionService } from './services/dispute-pattern-detection.service';
import { DisputeEnforcementService } from './services/dispute-enforcement.service';
import { DisputeAnalyticsService } from './services/dispute-analytics.service';
import { DisputeNotificationListener } from './listeners/dispute-notification.listener';
import { Trade } from '../trading-engine/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { TransactionsModule } from '../transactions/transactions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dispute,
      DisputeEvidence,
      DisputeMessage,
      DisputeTimeline,
      Arbitrator,
      Trade,
      User,
    ]),
    TransactionsModule,
    NotificationsModule,
  ],
  controllers: [DisputeResolutionController],
  providers: [
    DisputeResolutionService,
    DisputeEvidenceService,
    ArbitratorService,
    DisputePatternDetectionService,
    DisputeEnforcementService,
    DisputeAnalyticsService,
    DisputeNotificationListener,
  ],
  exports: [DisputeResolutionService, DisputeAnalyticsService],
})
export class DisputeResolutionModule {}
