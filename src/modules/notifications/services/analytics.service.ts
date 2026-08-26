import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { AlertRule } from '../interfaces/alert-rule.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationAnalytics } from '../entities/notification-analytics.entity';

interface ProcessingMetrics {
  totalEventsProcessed: number;
  totalAlertsTriggered: number;
  totalAlertsThrottled: number;
  totalDeduplicated: number;
  totalProcessingErrors: number;
  averageProcessingTime: number;
}

interface ChannelPerformance {
  channel: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  averageLatency: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly METRICS_KEY_PREFIX = 'analytics:notifications:';
  private processingTimes: number[] = [];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(NotificationAnalytics)
    private readonly analyticsRepository: Repository<NotificationAnalytics>,
  ) {}

  trackEventProcessed(startTime: number, alertsTriggered: number) {
    const processingTime = Date.now() - startTime;
    this.processingTimes.push(processingTime);

    // Keep only last 1000 processing times for average
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }

    this.incrementCounter('events_processed', 1);
    this.incrementCounter('alerts_triggered', alertsTriggered);

    // Persist to database periodically
    this.persistMetrics();
  }

  trackAlertTriggered(rule: AlertRule) {
    this.incrementCounter(`rule:${rule.id}:triggered`, 1);
    this.incrementCounter(`severity:${rule.metadata.severity}:triggered`, 1);

    // Log to analytics table
    const analytics = this.analyticsRepository.create({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.metadata.severity,
      category: rule.metadata.category,
      triggeredAt: new Date(),
      processingLatency:
        this.processingTimes[this.processingTimes.length - 1] || 0,
    });
    this.analyticsRepository.save(analytics);
  }

  trackThrottledAlert(rule: AlertRule) {
    this.incrementCounter('alerts_throttled', 1);
    this.incrementCounter(`rule:${rule.id}:throttled`, 1);
  }

  trackDeduplication() {
    this.incrementCounter('events_deduplicated', 1);
  }

  trackProcessingError() {
    this.incrementCounter('processing_errors', 1);
  }

  trackDeliveryAttempt(channel: string, success: boolean, latency: number) {
    this.incrementCounter(`channel:${channel}:attempted`, 1);
    if (success) {
      this.incrementCounter(`channel:${channel}:delivered`, 1);
    } else {
      this.incrementCounter(`channel:${channel}:failed`, 1);
    }

    // Track latency
    const latencyKey = `${this.METRICS_KEY_PREFIX}channel:${channel}:latencies`;
    this.redis.lpush(latencyKey, latency.toString());
    this.redis.ltrim(latencyKey, 0, 999); // Keep last 1000 latencies
  }

  trackUserEngagement(
    userId: string,
    notificationId: string,
    action: 'opened' | 'clicked' | 'dismissed',
  ) {
    this.incrementCounter(`user:${userId}:${action}`, 1);
    this.incrementCounter(`notification:${notificationId}:${action}`, 1);

    // Update analytics record
    this.analyticsRepository.update(
      { notificationId },
      { userAction: action, actionTimestamp: new Date() },
    );
  }

  private async incrementCounter(key: string, value: number) {
    const redisKey = `${this.METRICS_KEY_PREFIX}${key}`;
    await this.redis.incrby(redisKey, value);

    // Keep daily counters with expiration
    const dailyKey = `${this.METRICS_KEY_PREFIX}daily:${this.getCurrentDayKey()}:${key}`;
    await this.redis.incrby(dailyKey, value);
    await this.redis.expire(dailyKey, 86400 * 30); // 30 days
  }

  async getMetrics(): Promise<ProcessingMetrics> {
    const eventsProcessed = parseInt(
      (await this.redis.get(`${this.METRICS_KEY_PREFIX}events_processed`)) ||
        '0',
    );
    const alertsTriggered = parseInt(
      (await this.redis.get(`${this.METRICS_KEY_PREFIX}alerts_triggered`)) ||
        '0',
    );
    const alertsThrottled = parseInt(
      (await this.redis.get(`${this.METRICS_KEY_PREFIX}alerts_throttled`)) ||
        '0',
    );
    const deduplicated = parseInt(
      (await this.redis.get(`${this.METRICS_KEY_PREFIX}events_deduplicated`)) ||
        '0',
    );
    const errors = parseInt(
      (await this.redis.get(`${this.METRICS_KEY_PREFIX}processing_errors`)) ||
        '0',
    );

    const avgProcessingTime =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) /
          this.processingTimes.length
        : 0;

    return {
      totalEventsProcessed: eventsProcessed,
      totalAlertsTriggered: alertsTriggered,
      totalAlertsThrottled: alertsThrottled,
      totalDeduplicated: deduplicated,
      totalProcessingErrors: errors,
      averageProcessingTime: avgProcessingTime,
    };
  }

  async getChannelPerformance(): Promise<ChannelPerformance[]> {
    const channels = [
      'email',
      'sms',
      'websocket',
      'mobile_push',
      'telegram',
      'discord',
    ];
    const results: ChannelPerformance[] = [];

    for (const channel of channels) {
      const attempted = parseInt(
        (await this.redis.get(
          `${this.METRICS_KEY_PREFIX}channel:${channel}:attempted`,
        )) || '0',
      );
      const delivered = parseInt(
        (await this.redis.get(
          `${this.METRICS_KEY_PREFIX}channel:${channel}:delivered`,
        )) || '0',
      );
      const failed = attempted - delivered;

      // Get average latency
      const latencies = await this.redis.lrange(
        `${this.METRICS_KEY_PREFIX}channel:${channel}:latencies`,
        0,
        -1,
      );
      const avgLatency =
        latencies.length > 0
          ? latencies.reduce((sum, latency) => sum + parseInt(latency), 0) /
            latencies.length
          : 0;

      results.push({
        channel,
        sent: attempted,
        delivered,
        failed,
        deliveryRate: attempted > 0 ? delivered / attempted : 0,
        averageLatency: avgLatency,
      });
    }

    return results;
  }

  async getMostValuableAlertTypes(limit: number = 10): Promise<any[]> {
    // Find rules with highest user engagement (click-through rate)
    const analytics = await this.analyticsRepository
      .createQueryBuilder('analytics')
      .select('analytics.ruleName', 'ruleName')
      .addSelect('COUNT(*)', 'triggerCount')
      .addSelect(
        "SUM(CASE WHEN analytics.userAction = 'clicked' THEN 1 ELSE 0 END)",
        'clickCount',
      )
      .groupBy('analytics.ruleName')
      .orderBy('clickCount', 'DESC')
      .limit(limit)
      .getRawMany();

    return analytics.map((row) => ({
      ruleName: row.ruleName,
      totalTriggers: parseInt(row.triggerCount),
      totalClicks: parseInt(row.clickCount),
      ctr:
        parseInt(row.triggerCount) > 0
          ? parseInt(row.clickCount) / parseInt(row.triggerCount)
          : 0,
    }));
  }

  private async persistMetrics() {
    // Daily persistence of aggregated metrics
    if (Math.random() < 0.01) {
      // Only persist ~1% of the time to avoid overhead
      const metrics = await this.getMetrics();
      const record = this.analyticsRepository.create({
        ...metrics,
        triggeredAt: new Date(),
        type: 'aggregated_metrics',
      });
      await this.analyticsRepository.save(record);
    }
  }

  private getCurrentDayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }
}
