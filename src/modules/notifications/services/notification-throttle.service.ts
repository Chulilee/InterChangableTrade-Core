
import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { AlertRule } from '../interfaces/alert-rule.interface';
import { BlockchainEvent } from '../../blockchain-indexer/entities/blockchain-event.entity';

interface UserNotificationHistory {
  hourlyCount: Map<string, number>;
  dailyCount: Map<string, number>;
  lastSentAt: Map<string, Date>;
}

@Injectable()
export class NotificationThrottleService {
  private readonly logger = new Logger(NotificationThrottleService.name);
  private readonly THROTTLE_KEY_PREFIX = 'notification:throttle:';
  private userHistory: Map<string, UserNotificationHistory> = new Map();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async shouldSendNotification(rule: AlertRule, event: BlockchainEvent): Promise<boolean> {
    const userId = event.destinationAccount || 'global';
    const key = `${rule.id}:${userId}`;
    
    // Check cooldown period first
    if (await this.isInCooldown(rule, key)) {
      return false;
    }

    // Check hourly limit
    if (await this.exceedsHourlyLimit(rule, key)) {
      this.logger.debug(`⏱️ Hourly limit exceeded for ${rule.name} (user: ${userId})`);
      return false;
    }

    // Check daily limit
    if (await this.exceedsDailyLimit(rule, key)) {
      this.logger.debug(`⏱️ Daily limit exceeded for ${rule.name} (user: ${userId})`);
      return false;
    }

    // Update counters
    await this.recordNotificationSent(rule, key);
    return true;
  }

  private async isInCooldown(rule: AlertRule, key: string): Promise<boolean> {
    const lastSent = await this.redis.get(`${this.THROTTLE_KEY_PREFIX}last:${key}`);
    if (!lastSent) return false;
    
    const lastSentDate = new Date(lastSent);
    const cooldownMs = rule.rateLimit.cooldownPeriod * 1000;
    const timeSinceLastSent = Date.now() - lastSentDate.getTime();
    
    return timeSinceLastSent < cooldownMs;
  }

  private async exceedsHourlyLimit(rule: AlertRule, key: string): Promise<boolean> {
    const hourlyKey = `${this.THROTTLE_KEY_PREFIX}hourly:${key}:${this.getCurrentHourKey()}`;
    const currentCount = parseInt(await this.redis.get(hourlyKey) || '0');
    return currentCount >= rule.rateLimit.maxPerHour;
  }

  private async exceedsDailyLimit(rule: AlertRule, key: string): Promise<boolean> {
    const dailyKey = `${this.THROTTLE_KEY_PREFIX}daily:${key}:${this.getCurrentDayKey()}`;
    const currentCount = parseInt(await this.redis.get(dailyKey) || '0');
    return currentCount >= rule.rateLimit.maxPerDay;
  }

  private async recordNotificationSent(rule: AlertRule, key: string): Promise<void> {
    const now = new Date();
    
    // Update last sent timestamp
    await this.redis.set(`${this.THROTTLE_KEY_PREFIX}last:${key}`, now.toISOString());
    
    // Increment hourly counter with expiration
    const hourlyKey = `${this.THROTTLE_KEY_PREFIX}hourly:${key}:${this.getCurrentHourKey()}`;
    await this.redis.incr(hourlyKey);
    await this.redis.expire(hourlyKey, 3600); // Expire after 1 hour
    
    // Increment daily counter with expiration
    const dailyKey = `${this.THROTTLE_KEY_PREFIX}daily:${key}:${this.getCurrentDayKey()}`;
    await this.redis.incr(dailyKey);
    await this.redis.expire(dailyKey, 86400); // Expire after 24 hours
  }

  private getCurrentHourKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  }

  private getCurrentDayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }

  async getNotificationMetrics(userId: string) {
    const keys = await this.redis.keys(`${this.THROTTLE_KEY_PREFIX}*:${userId}*`);
    const metrics = {
      hourly: {} as Record<string, number>,
      daily: {} as Record<string, number>,
    };

    for (const key of keys) {
      const value = parseInt(await this.redis.get(key) || '0');
      if (key.includes('hourly')) {
        metrics.hourly[key] = value;
      } else if (key.includes('daily')) {
        metrics.daily[key] = value;
      }
    }

    return metrics;
  }
}