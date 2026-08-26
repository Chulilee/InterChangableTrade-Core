import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HorizonStreamService, LedgerCloseEvent } from './horizon-stream.service';
import { EventNormalizer } from './event-normalizer.service';
import { EventBufferService, BufferedEvent } from './event-buffer.service';
import { BatchedPersistenceService } from './batched-persistence.service';
import { SubscriptionManager, NormalizedEventPayload } from './subscription-manager.service';
import { IndexingStateService } from './indexing-state.service';
import { StellarEventSourceService } from './stellar-event-source.service';
import { EventStreamService } from './event-stream.service';

/**
 * Orchestrates the full real-time indexing pipeline:
 *
 * 1. HorizonStreamService → ledger close events (SSE stream)
 * 2. StellarEventSourceService → fetch transactions/operations per ledger
 * 3. EventNormalizer → convert to IndexedEvent shape with sequence numbers
 * 4. EventBufferService → in-memory deduplication and ordering
 * 5. BatchedPersistenceService → high-throughput PostgreSQL writes
 * 6. SubscriptionManager → distribute events to WebSocket subscribers
 *
 * This replaces the polling-based EventIndexerService with sub-second latency.
 */
@Injectable()
export class LedgerIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerIndexerService.name);

  private retentionTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly horizonStream: HorizonStreamService,
    private readonly eventSource: StellarEventSourceService,
    private readonly normalizer: EventNormalizer,
    private readonly buffer: EventBufferService,
    private readonly persistence: BatchedPersistenceService,
    private readonly subscriptionManager: SubscriptionManager,
    private readonly stateService: IndexingStateService,
    private readonly legacyStreamService: EventStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Starts the real-time indexing pipeline.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.logger.log('Starting real-time ledger indexer');

    // Initialize the sequence counter from persisted state.
    const lastSequence = await this.stateService.getSequenceCounter();
    this.normalizer.initializeSequenceCounter(lastSequence);

    // Start the persistence flush timer.
    this.persistence.startFlushTimer();

    // Wire up the Horizon SSE stream to process ledger close events.
    this.horizonStream.on('ledger', (event: LedgerCloseEvent) => {
      void this.handleLedgerClose(event);
    });

    // Start the SSE stream.
    await this.horizonStream.start();

    // Start periodic retention purge (every hour).
    this.retentionTimer = setInterval(
      () => {
        void this.persistence.purgeExpired();
      },
      60 * 60 * 1000,
    );
    this.retentionTimer.unref?.();

    this.logger.log('Real-time ledger indexer started');
  }

  /**
   * Gracefully stops the pipeline.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    this.horizonStream.stop();

    // Final flush.
    await this.persistence.flush();

    this.logger.log('Real-time ledger indexer stopped');
  }

  /**
   * Handles a new ledger close event from the Horizon SSE stream.
   * Fetches all transactions/operations for the ledger, normalizes them,
   * buffers them, and triggers persistence.
   */
  private async handleLedgerClose(ledgerEvent: LedgerCloseEvent): Promise<void> {
    const ledger = ledgerEvent.sequence;
    this.logger.debug(`Processing ledger close: ${ledger}`);

    try {
      // Fetch all transactions for this ledger.
      const transactions = await this.eventSource.getTransactionsByLedgerRange(
        ledger,
        ledger,
      );

      // Process each transaction's operations.
      for (const tx of transactions) {
        if (!tx.successful) continue;

        let operations;
        try {
          operations = await this.eventSource.getOperationsForTransaction(tx.hash);
        } catch {
          this.logger.warn(
            `Failed to fetch operations for tx ${tx.hash} in ledger ${ledger}`,
          );
          continue;
        }

        // Normalize operations into IndexedEvent inputs.
        const normalizedEvents =
          this.normalizer.normalizeStellarOperations(tx, operations);

        // Assign sequence numbers and convert to buffered events.
        const bufferedEvents: BufferedEvent[] = normalizedEvents.map((event) => {
          const withSequence = this.normalizer.assignSequence(event);
          return {
            sequenceNumber: Number(withSequence.sequenceNumber),
            ledgerSequence: withSequence.ledgerSequence,
            eventType: withSequence.eventType,
            timestamp: withSequence.timestamp.getTime(),
            data: withSequence as unknown as Record<string, unknown>,
            bufferedAt: Date.now(),
          };
        });

        // Add to the buffer (deduplication happens here).
        const accepted = this.buffer.pushBatch(bufferedEvents);
        if (accepted > 0) {
          // Drain the buffer and persist.
          const toPersist = this.buffer.drain(this.buffer.getStats().bufferSize);
          await this.persistAndDistribute(toPersist);
        }
      }

      // Persist the ledger cursor for stream resumption.
      await this.stateService.setLedgerCursor(String(ledger));
    } catch (error) {
      this.logger.warn(
        `Failed to process ledger ${ledger}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handles Soroban contract events from the ContractEventIndexerService.
   * Called externally when new Soroban events are detected.
   */
  async handleSorobanEvents(
    events: Array<{ topics: unknown[]; value: unknown; [key: string]: unknown }>,
  ): Promise<void> {
    if (events.length === 0) return;

    const normalizedEvents = this.normalizer.normalizeSorobanEvents(
      events as any,
    );

    const bufferedEvents: BufferedEvent[] = normalizedEvents.map((event) => {
      const withSequence = this.normalizer.assignSequence(event);
      return {
        sequenceNumber: Number(withSequence.sequenceNumber),
        ledgerSequence: withSequence.ledgerSequence,
        eventType: withSequence.eventType,
        timestamp: withSequence.timestamp.getTime(),
        data: withSequence as unknown as Record<string, unknown>,
        bufferedAt: Date.now(),
      };
    });

    const accepted = this.buffer.pushBatch(bufferedEvents);
    if (accepted > 0) {
      const toPersist = this.buffer.drain(this.buffer.getStats().bufferSize);
      await this.persistAndDistribute(toPersist);
    }
  }

  /**
   * Persists events to the database and distributes them to subscribers.
   */
  private async persistAndDistribute(
    events: BufferedEvent[],
  ): Promise<void> {
    if (events.length === 0) return;

    // Enqueue for batched persistence.
    for (const event of events) {
      this.persistence.enqueue(event.data as any);
    }

    // Distribute to WebSocket subscribers.
    for (const event of events) {
      const payload: NormalizedEventPayload = {
        sequenceNumber: event.sequenceNumber,
        ledgerSequence: event.ledgerSequence,
        eventType: event.eventType,
        transactionHash: (event.data.transactionHash as string) ?? '',
        timestamp: new Date(event.timestamp).toISOString(),
        sourceAccount: (event.data.sourceAccount as string) ?? '',
        destinationAccount: event.data.destinationAccount as string | undefined,
        contractId: event.data.contractId as string | undefined,
        methodName: event.data.methodName as string | undefined,
        assetCode: event.data.assetCode as string | undefined,
        amount: event.data.amount as string | undefined,
        topics: event.data.topics as unknown[] | undefined,
        value: event.data.value as unknown | undefined,
        normalizedData: event.data.normalizedData as
          | Record<string, unknown>
          | undefined,
      };

      this.subscriptionManager.distributeEvent(payload);

      // Also publish to the legacy Redis stream for backward compatibility.
      void this.legacyStreamService.publish(
        event.data as any,
      );
    }
  }

  /**
   * Returns comprehensive status of the real-time indexer.
   */
  async getStatus() {
    const horizonConnected = this.horizonStream.isConnected();
    const lastLedger = this.horizonStream.getLastLedgerSequence();
    const bufferStats = this.buffer.getStats();
    const persistenceStats = this.persistence.getStats();
    const subscriptionCount = this.subscriptionManager.getSubscriptionCount();
    const clientCount = this.subscriptionManager.getClientCount();

    return {
      running: this.running,
      horizonConnected,
      lastLedgerSequence: lastLedger,
      sequenceCounter: Number(this.normalizer.getCurrentSequence()),
      buffer: bufferStats,
      persistence: persistenceStats,
      subscriptions: {
        total: subscriptionCount,
        clients: clientCount,
      },
    };
  }
}
