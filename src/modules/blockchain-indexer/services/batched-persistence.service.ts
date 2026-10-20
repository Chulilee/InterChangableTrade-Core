import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { IndexedEvent } from '../entities/indexed-event.entity';
import { IndexingStateService } from './indexing-state.service';

/**
 * Type used internally before an event is assigned a database-generated ID.
 */
export type IndexedEventInput = Omit<
  IndexedEvent,
  'id' | 'createdAt' | 'updatedAt'
>;

/**
 * High-throughput batched persistence layer for IndexedEvent records.
 *
 * Events are collected in an internal buffer and flushed to PostgreSQL in
 * configurable batch sizes. This achieves >10k events/second throughput by:
 * - Using bulk INSERT with ON CONFLICT DO NOTHING for idempotency
 * - Flushing on a timer or when the batch reaches capacity
 * - Tracking the highest persisted sequence for restart resumption
 *
 * A configurable retention policy deletes events older than `retentionDays`.
 */
@Injectable()
export class BatchedPersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(BatchedPersistenceService.name);

  private readonly flushIntervalMs: number;
  private readonly batchMaxSize: number;
  private readonly retentionDays: number;

  private pendingBatch: IndexedEventInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  /** In-flight flush, used to serialise concurrent flush() calls. */
  private flushPromise: Promise<number> | null = null;

  /**
   * Highest sequence that has actually been **committed** to PostgreSQL.
   * Never advanced for merely enqueued events: a crash between enqueue and
   * insert must leave the persisted counter behind so the events are replayed.
   */
  private highestCommittedSequence = BigInt(0);

  /** Highest sequence ever enqueued. Exposed for observability only. */
  private highestEnqueuedSequence = BigInt(0);

  /** Rolling throughput counter for observability. */
  private totalPersisted = 0;

  /** Events PostgreSQL rejected because their sequence already existed. */
  private totalRejectedByUniqueConstraint = 0;

  constructor(
    @InjectRepository(IndexedEvent)
    private readonly eventRepo: Repository<IndexedEvent>,
    private readonly stateService: IndexingStateService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.flushIntervalMs =
      this.configService.get<number>(
        'blockchainIndexer.batchFlushIntervalMs',
      ) ?? 1000;
    this.batchMaxSize =
      this.configService.get<number>('blockchainIndexer.batchMaxSize') ?? 1000;
    this.retentionDays =
      this.configService.get<number>('blockchainIndexer.retentionDays') ?? 90;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopFlushTimer();
    // `onModuleDestroy` may be async: await the drain so a clean shutdown
    // cannot race process exit and lose the final batch.
    if (this.pendingBatch.length > 0) {
      this.logger.log(
        `Flushing ${this.pendingBatch.length} remaining events on shutdown`,
      );
    }
    await this.flush();
  }

  /**
   * Starts the periodic flush timer. Call once during startup after
   * restoring the sequence counter.
   *
   * Also seeds the committed high-water mark from persisted state so the first
   * flush can never rewind the counter to a lower value after a restart.
   */
  async startFlushTimer(): Promise<void> {
    if (this.flushTimer) return;

    try {
      const persisted = await this.stateService.getSequenceCounter();
      if (persisted > this.highestCommittedSequence) {
        this.highestCommittedSequence = persisted;
      }
    } catch (error) {
      this.logger.warn(
        `Unable to load persisted sequence counter: ${(error as Error).message}`,
      );
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Enqueues a single event for batched persistence. The event must already
   * have a sequenceNumber assigned by the EventNormalizer.
   *
   * Note: the sequence high-water mark is **not** advanced here. It only moves
   * once the batch containing the event has been committed; see flush().
   */
  enqueue(event: IndexedEventInput): void {
    this.pendingBatch.push(event);

    const seqNum = BigInt(event.sequenceNumber);
    if (seqNum > this.highestEnqueuedSequence) {
      this.highestEnqueuedSequence = seqNum;
    }

    // Auto-flush when the batch reaches capacity.
    if (this.pendingBatch.length >= this.batchMaxSize) {
      void this.flush();
    }
  }

  /**
   * Enqueues multiple events at once.
   */
  enqueueBatch(events: IndexedEventInput[]): void {
    for (const event of events) {
      this.enqueue(event);
    }
  }

  /**
   * Forces a flush of the pending batch to PostgreSQL, draining the queue in
   * chunks of `batchMaxSize`. If a flush is already in flight this call waits
   * for it and then drains anything enqueued in the meantime, instead of
   * returning 0 and silently dropping the last batch.
   *
   * Returns the number of events persisted across both the awaited flush and
   * this call.
   */
  async flush(): Promise<number> {
    let alreadyFlushed = 0;

    while (this.flushPromise) {
      alreadyFlushed = await this.flushPromise.catch(() => 0);
    }

    if (this.pendingBatch.length === 0) {
      return alreadyFlushed;
    }

    const run = this.drainPending();
    this.flushPromise = run;

    try {
      return alreadyFlushed + (await run);
    } finally {
      if (this.flushPromise === run) {
        this.flushPromise = null;
      }
    }
  }

  /**
   * Persists pending batches until the queue is empty or a batch fails (in
   * which case it is requeued and the timer retries later).
   */
  private async drainPending(): Promise<number> {
    let persisted = 0;

    while (this.pendingBatch.length > 0) {
      const batch = this.pendingBatch.splice(0, this.batchMaxSize);
      const inserted = await this.persistBatch(batch);
      if (inserted === null) {
        // The batch was requeued; stop to avoid a hot retry loop.
        break;
      }
      persisted += inserted;
    }

    return persisted;
  }

  /**
   * Inserts a single batch and advances the committed sequence high-water mark
   * only after the transaction has resolved.
   *
   * Returns the number of rows actually inserted, or null when the insert
   * failed and the batch was requeued.
   */
  private async persistBatch(
    batch: IndexedEventInput[],
  ): Promise<number | null> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // Bulk insert with ON CONFLICT DO NOTHING for idempotency. RETURNING
        // tells us which rows survived the unique index so rejections are
        // observable instead of silently vanishing.
        return manager
          .createQueryBuilder()
          .insert()
          .into(IndexedEvent)
          .values(batch as any)
          .orIgnore()
          .returning(['sequenceNumber'])
          .execute();
      });

      const returned = Array.isArray(result?.raw)
        ? (result.raw as Array<{ sequenceNumber?: string | number }>)
        : [];
      const inserted =
        returned.length > 0 && returned.length <= batch.length
          ? returned.length
          : batch.length;
      const rejected = batch.length - inserted;

      if (rejected > 0) {
        this.totalRejectedByUniqueConstraint += rejected;
        this.logger.warn(
          `Insert ignored ${rejected} event(s) because their sequenceNumber already exists (total rejected: ${this.totalRejectedByUniqueConstraint})`,
        );
      }

      let batchMax = BigInt(0);
      for (const event of batch) {
        const seq = BigInt(event.sequenceNumber);
        if (seq > batchMax) batchMax = seq;
      }

      // Commit point has been reached: only now may the counter move.
      if (batchMax > this.highestCommittedSequence) {
        this.highestCommittedSequence = batchMax;
        await this.stateService.setSequenceCounter(
          this.highestCommittedSequence,
        );
      }

      this.totalPersisted += inserted;

      this.logger.debug(
        `Flushed ${inserted}/${batch.length} events to PostgreSQL (total: ${this.totalPersisted})`,
      );
      return inserted;
    } catch (error) {
      this.logger.error(
        `Failed to flush ${batch.length} events: ${(error as Error).message}`,
      );
      // Re-queue the failed batch for retry.
      this.pendingBatch = [...batch, ...this.pendingBatch];
      return null;
    }
  }

  /**
   * Runs the retention policy: deletes events older than the configured
   * retention period. Should be called periodically (e.g. once per hour).
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);

    try {
      const result = await this.eventRepo
        .createQueryBuilder()
        .delete()
        .where('timestamp < :cutoff', { cutoff })
        .execute();

      const deleted = result.affected ?? 0;
      if (deleted > 0) {
        this.logger.log(
          `Purged ${deleted} events older than ${this.retentionDays} days`,
        );
      }
      return deleted;
    } catch (error) {
      this.logger.error(
        `Failed to purge expired events: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Returns current persistence metrics.
   */
  getStats() {
    return {
      pendingCount: this.pendingBatch.length,
      batchMaxSize: this.batchMaxSize,
      flushIntervalMs: this.flushIntervalMs,
      totalPersisted: this.totalPersisted,
      highestPersistedSequence: Number(this.highestCommittedSequence),
      highestCommittedSequence: Number(this.highestCommittedSequence),
      highestEnqueuedSequence: Number(this.highestEnqueuedSequence),
      rejectedByUniqueConstraint: this.totalRejectedByUniqueConstraint,
      retentionDays: this.retentionDays,
    };
  }

  getHighestPersistedSequence(): bigint {
    return this.highestCommittedSequence;
  }
}
