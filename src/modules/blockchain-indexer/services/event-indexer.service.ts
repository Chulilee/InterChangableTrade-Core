import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  BlockchainEvent,
  BlockchainEventType,
} from '../entities/blockchain-event.entity';
import { IndexingStateService } from './indexing-state.service';
import {
  StellarEventSourceService,
  RawOperation,
  RawTransaction,
} from './stellar-event-source.service';
import { EventStreamService } from './event-stream.service';

const TRADE_RELEVANT_OPERATIONS = new Set([
  BlockchainEventType.PAYMENT,
  BlockchainEventType.PATH_PAYMENT_STRICT_RECEIVE,
  BlockchainEventType.PATH_PAYMENT_STRICT_SEND,
  BlockchainEventType.MANAGE_OFFER,
  BlockchainEventType.MANAGE_OFFER_WITHDRAW,
  BlockchainEventType.CREATE_ACCOUNT,
  BlockchainEventType.ACCOUNT_MERGE,
]);

@Injectable()
export class EventIndexerService {
  private readonly logger = new Logger(EventIndexerService.name);
  private indexing = false;
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private readonly eventSource: StellarEventSourceService,
    private readonly stateService: IndexingStateService,
    @InjectRepository(BlockchainEvent)
    private readonly eventRepo: Repository<BlockchainEvent>,
    private readonly streamService: EventStreamService,
    private readonly dataSource: DataSource,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.shuttingDown = false;
    this.logger.log('Starting blockchain event indexer');
    await this.indexNewEvents();
    this.timer = setInterval(() => {
      void this.indexNewEvents();
    }, this.eventSource.getPollIntervalMs());
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Blockchain event indexer stopped');
  }

  async indexNewEvents(): Promise<void> {
    if (this.indexing || this.shuttingDown) return;
    this.indexing = true;

    try {
      const cursor = await this.stateService.getLastCursor();
      const transactions = await this.eventSource.getTransactionsSinceCursor(
        cursor ?? '',
        this.eventSource.getPageLimit(),
      );

      if (transactions.length === 0) {
        return;
      }

      this.logger.debug(`Processing ${transactions.length} new transactions`);

      for (const tx of transactions) {
        if (this.shuttingDown) break;
        await this.processTransaction(tx);
      }

      const lastTx = transactions[transactions.length - 1];
      if (lastTx) {
        await this.stateService.setLastCursor(lastTx.paging_token);
        // Store the ledger hash alongside the cursor so reorg detection can
        // compare the indexed chain against Horizon's canonical chain.
        const ledger = await this.eventSource.getLedger(lastTx.ledger);
        await this.stateService.setLastIndexedLedger(
          lastTx.ledger,
          ledger?.hash ?? null,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Indexing cycle failed: ${(error as Error).message}. Will retry next cycle.`,
      );
    } finally {
      this.indexing = false;
    }
  }

  private async processTransaction(tx: RawTransaction): Promise<void> {
    if (!tx.successful) {
      return;
    }

    let operations: RawOperation[];
    try {
      operations = await this.eventSource.getOperationsForTransaction(tx.hash);
    } catch {
      this.logger.warn(`Failed to fetch operations for tx ${tx.hash}`);
      return;
    }

    const tradeEvents = this.transformOperations(tx, operations);
    await this.deduplicateAndPersist(tradeEvents);
  }

  private transformOperations(
    tx: RawTransaction,
    operations: RawOperation[],
  ): Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>[] {
    const results: Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>[] =
      [];

    for (const op of operations) {
      if (!TRADE_RELEVANT_OPERATIONS.has(op.type as BlockchainEventType)) {
        continue;
      }

      const eventType = op.type as BlockchainEventType;
      let assetCode = 'native';
      let assetIssuer: string | undefined;
      let amount = '0';
      let destinationAccount: string | undefined;

      if (eventType === BlockchainEventType.PAYMENT) {
        assetCode = op.asset_code ?? 'native';
        assetIssuer = op.asset_issuer;
        amount = op.amount ?? '0';
        destinationAccount = op.to;
      } else if (
        eventType === BlockchainEventType.PATH_PAYMENT_STRICT_RECEIVE ||
        eventType === BlockchainEventType.PATH_PAYMENT_STRICT_SEND
      ) {
        assetCode = op.asset_code ?? 'native';
        assetIssuer = op.asset_issuer;
        amount = op.amount ?? '0';
        destinationAccount = op.to;
      } else if (
        eventType === BlockchainEventType.MANAGE_OFFER ||
        eventType === BlockchainEventType.MANAGE_OFFER_WITHDRAW
      ) {
        assetCode = op.asset_code ?? 'native';
        assetIssuer = op.asset_issuer;
        amount = op.amount ?? '0';
      } else if (eventType === BlockchainEventType.CREATE_ACCOUNT) {
        destinationAccount = op.to;
        amount = op.starting_balance ?? '0';
        assetCode = 'native';
      } else if (eventType === BlockchainEventType.ACCOUNT_MERGE) {
        destinationAccount = op.into;
      }

      results.push({
        uniqueId: `${tx.hash}:${op.application_index}`,
        eventType,
        transactionHash: tx.hash,
        ledger: tx.ledger,
        timestamp: new Date(tx.created_at),
        sourceAccount: op.from ?? tx.source_account,
        destinationAccount,
        assetCode,
        assetIssuer,
        amount,
        raw: { operation: op, transaction: tx },
        invalidated: false,
      });
    }

    return results;
  }

  private async deduplicateAndPersist(
    events: Omit<BlockchainEvent, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<void> {
    if (events.length === 0) return;

    // The unique index on `uniqueId` (see
    // AddUniqueIdIndexOnBlockchainEvents migration) makes `ON CONFLICT DO
    // NOTHING` sufficient for storage-level idempotency. We use `returning`
    // to learn which rows were actually inserted so we only publish genuinely
    // new events to the stream — no expensive OR-chain pre-check needed.
    const insertedEvents: Omit<
      BlockchainEvent,
      'id' | 'createdAt' | 'updatedAt'
    >[] = [];

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(BlockchainEvent)
        .values(events)
        .orIgnore()
        .returning(['uniqueId'])
        .execute();

      const insertedIds = new Set(
        (result.raw as Array<{ uniqueId: string }>).map((row) => row.uniqueId),
      );
      for (const event of events) {
        if (insertedIds.has(event.uniqueId)) {
          insertedEvents.push(event);
        }
      }
    });

    for (const event of insertedEvents) {
      await this.streamService.publish(event);
    }
  }
}
