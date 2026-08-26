import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications.service';
import { BlockchainEvent } from '../../blockchain-indexer/entities/blockchain-event.entity';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { Inject } from '@nestjs/common';
import {
  AlertRule,
  AlertCondition,
  AlertAction,
} from '../interfaces/alert-rule.interface';
import { RuleEvaluationService } from './rule-evaluation.service';
import { NotificationThrottleService } from './notification-throttle.service';
import { AnalyticsService } from './analytics.service';
import { DeduplicationService } from './deduplication.service';

@Injectable()
export class AlertingService implements OnModuleInit {
  private readonly logger = new Logger(AlertingService.name);
  private readonly eventChannel = 'blockchain:events:stream';
  private subscriber: Redis;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly ruleEvaluationService: RuleEvaluationService,
    private readonly throttleService: NotificationThrottleService,
    private readonly analyticsService: AnalyticsService,
    private readonly deduplicationService: DeduplicationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.subscriber = this.redis.duplicate();
  }

  async onModuleInit() {
    try {
      await this.subscriber.subscribe(this.eventChannel);
      this.subscriber.on('message', async (channel, message) => {
        if (channel === this.eventChannel) {
          await this.handleEvent(JSON.parse(message));
        }
      });
      this.logger.log(`✅ Subscribed to Redis channel: ${this.eventChannel}`);
    } catch (error) {
      this.logger.error(
        `❌ Failed to subscribe to Redis channel: ${this.eventChannel}`,
        error,
      );
    }
  }

  private async handleEvent(event: BlockchainEvent) {
    const startTime = Date.now();
    this.logger.debug(
      `📥 Received event: ${event.eventType} [${event.uniqueId}]`,
    );

    try {
      // 1. Deduplication check
      if (await this.deduplicationService.isDuplicate(event)) {
        this.logger.debug(`🚫 Duplicate event skipped: ${event.uniqueId}`);
        this.analyticsService.trackDeduplication();
        return;
      }

      // 2. Evaluate all applicable rules
      const matchingRules =
        await this.ruleEvaluationService.evaluateRules(event);

      if (matchingRules.length === 0) {
        this.analyticsService.trackEventProcessed(startTime, 0);
        return;
      }

      // 3. Process each matching rule with throttling
      for (const rule of matchingRules) {
        if (await this.throttleService.shouldSendNotification(rule, event)) {
          await this.sendAlert(rule, event);
          this.analyticsService.trackAlertTriggered(rule);
        } else {
          this.logger.debug(`⏱️ Notification throttled for rule: ${rule.name}`);
          this.analyticsService.trackThrottledAlert(rule);
        }
      }

      this.analyticsService.trackEventProcessed(
        startTime,
        matchingRules.length,
      );
    } catch (error) {
      this.logger.error(`⚠️ Error processing event ${event.uniqueId}:`, error);
      this.analyticsService.trackProcessingError();
    }
  }

  private async sendAlert(rule: AlertRule, event: BlockchainEvent) {
    const notification = rule.getNotification(event);
    const recipients = await this.ruleEvaluationService.getAffectedUsers(
      event,
      rule,
    );

    for (const userId of recipients) {
      await this.notificationsService.sendNotificationToUser(
        userId,
        notification,
        rule.metadata,
      );
    }

    this.logger.log(
      `🚀 Alert sent: "${rule.name}" to ${recipients.length} users`,
    );
  }
}
