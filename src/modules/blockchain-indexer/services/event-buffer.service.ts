import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * A buffered event with its sequence number for ordering.
 */
export interface BufferedEvent {
  sequenceNumber: number;
  ledgerSequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
  /** Epoch millis when the event entered the buffer. */
  bufferedAt: number;
}

/**
 * In-memory event buffer that provides:
 * - Deduplication by sequence number
 * - Ordering guarantees via sequence numbers
 * - TTL-based expiry for stale events
 * - FIFO batch extraction for persistence
 *
 * This sits between the event normalizer and the persistence layer, absorbing
 * bursts of events while maintaining ordering and preventing duplicates.
 */
@Injectable()
export class EventBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBufferService.name);
  private readonly maxBufferSize: number;
  private readonly eventTtlMs: number;

  /** Events keyed by sequence number for O(1) deduplication lookups. */
  private readonly buffer = new Map<number, BufferedEvent>();

  /** Sorted sequence numbers for ordered extraction. */
  private readonly sequenceOrder: number[] = [];

  /** Timer for periodic TTL cleanup. */
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** Metrics counters. */
  private stats = {
    totalReceived: 0,
    totalDuplicates: 0,
    totalExpired: 0,
  };

  constructor(private readonly configService: ConfigService) {
    this.maxBufferSize =
      this.configService.get<number>('blockchainIndexer.eventBufferSize') ?? 10000;
    this.eventTtlMs =
      this.configService.get<number>('blockchainIndexer.eventBufferTtlMs') ?? 60000;

    // Start periodic cleanup to evict expired events.
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      Math.min(this.eventTtlMs / 2, 10000),
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /**
   * Pushes a single event into the buffer. Returns true if the event was
   * accepted, false if it was a duplicate or the buffer is full.
   */
  push(event: BufferedEvent): boolean {
    this.stats.totalReceived++;

    // Deduplication: reject if we already have this sequence number.
    if (this.buffer.has(event.sequenceNumber)) {
      this.stats.totalDuplicates++;
      return false;
    }

    // If the buffer is at capacity, evict the oldest event.
    if (this.buffer.size >= this.maxBufferSize) {
      this.evictOldest();
    }

    if (!event.bufferedAt) {
      event.bufferedAt = Date.now();
    }
    this.buffer.set(event.sequenceNumber, event);
    this.sequenceOrder.push(event.sequenceNumber);

    // Keep the sequence order sorted for efficient ordered extraction.
    // For small arrays this is fine; for large arrays we'd use a heap.
    if (this.sequenceOrder.length > 1) {
      const last = this.sequenceOrder[this.sequenceOrder.length - 1];
      const prev = this.sequenceOrder[this.sequenceOrder.length - 2];
      if (prev !== undefined && last !== undefined && last < prev) {
        this.sequenceOrder.sort((a, b) => a - b);
      }
    }

    return true;
  }

  /**
   * Pushes multiple events at once. Returns the count of events accepted.
   */
  pushBatch(events: BufferedEvent[]): number {
    let accepted = 0;
    for (const event of events) {
      if (this.push(event)) {
        accepted++;
      }
    }
    return accepted;
  }

  /**
   * Drains up to `maxCount` events from the buffer in sequence-number order.
   * Returns them sorted oldest-first and removes them from the buffer.
   */
  drain(maxCount: number): BufferedEvent[] {
    const count = Math.min(maxCount, this.sequenceOrder.length);
    const sequences = this.sequenceOrder.splice(0, count);
    const events: BufferedEvent[] = [];

    for (const seq of sequences) {
      const event = this.buffer.get(seq);
      if (event) {
        events.push(event);
        this.buffer.delete(seq);
      }
    }

    return events;
  }

  /**
   * Peek at the next events without removing them.
   */
  peek(count: number): BufferedEvent[] {
    const sequences = this.sequenceOrder.slice(0, count);
    return sequences
      .map((seq) => this.buffer.get(seq))
      .filter((e): e is BufferedEvent => e !== undefined);
  }

  /**
   * Removes events older than the TTL.
   */
  evictExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [seq, event] of this.buffer) {
      if (now - event.bufferedAt > this.eventTtlMs) {
        this.buffer.delete(seq);
        evicted++;
      }
    }

    // Rebuild sequence order from remaining entries.
    if (evicted > 0) {
      this.sequenceOrder.length = 0;
      for (const seq of this.buffer.keys()) {
        this.sequenceOrder.push(seq);
      }
      this.sequenceOrder.sort((a, b) => a - b);
      this.stats.totalExpired += evicted;
      this.logger.debug(`Evicted ${evicted} expired events from buffer`);
    }
  }

  /**
   * Resets all internal state and counters. Useful for testing.
   */
  reset(): void {
    this.buffer.clear();
    this.sequenceOrder.length = 0;
    this.stats = { totalReceived: 0, totalDuplicates: 0, totalExpired: 0 };
  }

  /**
   * Returns current buffer statistics.
   */
  getStats() {
    return {
      bufferSize: this.buffer.size,
      maxBufferSize: this.maxBufferSize,
      totalReceived: this.stats.totalReceived,
      totalDuplicates: this.stats.totalDuplicates,
      totalExpired: this.stats.totalExpired,
      oldestSequence:
        this.sequenceOrder.length > 0 ? this.sequenceOrder[0] : null,
      newestSequence:
        this.sequenceOrder.length > 0
          ? this.sequenceOrder[this.sequenceOrder.length - 1]
          : null,
    };
  }

  private evictOldest(): void {
    if (this.sequenceOrder.length === 0) return;
    const oldest = this.sequenceOrder.shift();
    if (oldest !== undefined) {
      this.buffer.delete(oldest);
    }
  }
}
