import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationStrategy } from './providers/notification.strategy';
import { WebSocketNotificationProvider } from './providers/websocket-notification.provider';
import { EmailNotificationProvider } from './providers/email-notification.provider';
import { SmsNotificationProvider } from './providers/sms-notification.provider';
import { TelegramNotificationProvider } from './providers/telegram-notification.provider';
import { DiscordNotificationProvider } from './providers/discord-notification.provider';
import { NotificationGateway } from './providers/notification.gateway';
import { NotificationListener } from './listeners/notification.listener';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { NotificationAnalytics } from './entities/notification-analytics.entity';
import { RedisModule } from '../../redis/redis.module';
import { BlockchainIndexerModule } from '../blockchain-indexer/blockchain-indexer.module';
import { AlertingService } from './services/alerting.service';
import { RuleEvaluationService } from './services/rule-evaluation.service';
import { NotificationThrottleService } from './services/notification-throttle.service';
import { AnalyticsService } from './services/analytics.service';
import { DeduplicationService } from './services/deduplication.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      NotificationTemplate,
      NotificationAnalytics,
    ]),
    RedisModule,
    BlockchainIndexerModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationGateway,
    NotificationStrategy,
    WebSocketNotificationProvider,
    EmailNotificationProvider,
    SmsNotificationProvider,
    TelegramNotificationProvider,
    DiscordNotificationProvider,
    NotificationListener,
    // Smart Alerting Services
    AlertingService,
    RuleEvaluationService,
    NotificationThrottleService,
    AnalyticsService,
    DeduplicationService,
  ],
  exports: [
    NotificationsService,
    NotificationGateway,
    AlertingService,
    AnalyticsService,
  ],
})
export class NotificationsModule {}
