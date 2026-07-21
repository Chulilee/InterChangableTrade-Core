import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { BlockchainEvent } from '../entities/blockchain-event.entity';

@Injectable()
export class EventStreamService {
  private readonly logger = new Logger(EventStreamService.name);
  private readonly channel = 'blockchain:events:stream';
  private readonly recentKey = 'blockchain:events:recent';
  private readonly recentLimit = 1000;
  private readonly recentTtlSecs = 300;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async publish(
    event: Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    try {
      await this.redis.publish(this.channel, JSON.stringify(event));
      await this.addToRecent(event);
    } catch (error) {
      this.logger.warn(
        `Failed to publish event to stream: ${(error as Error).message}`,
      );
    }
  }

  async getRecentEvents(
    limit = 50,
  ): Promise<Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>[]> {
    try {
      const events = await this.redis.lrange(this.recentKey, 0, limit - 1);
      return events.map((e) => JSON.parse(e));
    } catch (error) {
      this.logger.warn(
        `Failed to fetch recent events: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async addToRecent(
    event: Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    try {
      await this.redis.lpush(this.recentKey, JSON.stringify(event));
      await this.redis.ltrim(this.recentKey, 0, this.recentLimit - 1);
      await this.redis.expire(this.recentKey, this.recentTtlSecs);
    } catch (error) {
      this.logger.warn(
        `Failed to add event to recent list: ${(error as Error).message}`,
      );
    }
  }
}
