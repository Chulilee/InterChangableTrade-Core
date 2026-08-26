
import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { BlockchainEvent } from '../../blockchain-indexer/entities/blockchain-event.entity';
import * as crypto from 'crypto';

@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);
  private readonly DEDUPE_KEY_PREFIX = 'event:dedupe:';
  private readonly WINDOW_SECONDS = 300; // 5 minute deduplication window
  private readonly EVENT_SIMILARITY_THRESHOLD = 0.9;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isDuplicate(event: BlockchainEvent): Promise<boolean> {
    // 1. Check for exact duplicate by uniqueId
    if (await this.isExactDuplicate(event.uniqueId)) {
      this.logger.debug(`Exact duplicate detected: ${event.uniqueId}`);
      return true;
    }

    // 2. Check for similar events that might be duplicates
    if (await this.isSimilarDuplicate(event)) {
      this.logger.debug(`Similar duplicate detected: ${event.uniqueId}`);
      return true;
    }

    // 3. Record this event
    await this.recordEvent(event);
    return false;
  }

  private async isExactDuplicate(uniqueId: string): Promise<boolean> {
    const key = `${this.DEDUPE_KEY_PREFIX}exact:${uniqueId}`;
    const exists = await this.redis.get(key);
    
    if (!exists) {
      return false;
    }
    return true;
  }

  private async isSimilarDuplicate(event: BlockchainEvent): Promise<boolean> {
    // Generate a fingerprint for event similarity checking
    const fingerprint = this.generateEventFingerprint(event);
    const key = `${this.DEDUPE_KEY_PREFIX}similar:${fingerprint}`;
    
    const lastSeen = await this.redis.get(key);
    if (!lastSeen) {
      return false;
    }

    const lastSeenDate = new Date(lastSeen);
    const timeSinceLastSeen = Date.now() - lastSeenDate.getTime();
    
    // If we've seen a similar event within the window, consider it a duplicate
    return timeSinceLastSeen < (this.WINDOW_SECONDS * 1000);
  }

  private generateEventFingerprint(event: BlockchainEvent): string {
    // Create a hash of key event properties to identify similar events
    const dataToHash = {
      eventType: event.eventType,
      sourceAccount: event.sourceAccount,
      destinationAccount: event.destinationAccount,
      assetCode: event.assetCode,
      // Round amount to nearest 100 to catch similar amounts
      amount: Math.round(parseFloat(event.amount) / 100) * 100,
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(dataToHash))
      .digest('hex');
  }

  private async recordEvent(event: BlockchainEvent): Promise<void> {
    // Record exact match
    await this.redis.set(
      `${this.DEDUPE_KEY_PREFIX}exact:${event.uniqueId}`,
      new Date().toISOString()
    );
    await this.redis.expire(
      `${this.DEDUPE_KEY_PREFIX}exact:${event.uniqueId}`,
      this.WINDOW_SECONDS
    );

    // Record similarity match
    const fingerprint = this.generateEventFingerprint(event);
    await this.redis.set(
      `${this.DEDUPE_KEY_PREFIX}similar:${fingerprint}`,
      new Date().toISOString()
    );
    await this.redis.expire(
      `${this.DEDUPE_KEY_PREFIX}similar:${fingerprint}`,
      this.WINDOW_SECONDS
    );
  }

  async getDeduplicationStats(): Promise<{ currentWindowSize: number; deduplicated: number }> {
    const keys = await this.redis.keys(`${this.DEDUPE_KEY_PREFIX}*`);
    return {
      currentWindowSize: keys.length,
      deduplicated: 0, // This would track historical deduplication in a real implementation
    };
  }
}