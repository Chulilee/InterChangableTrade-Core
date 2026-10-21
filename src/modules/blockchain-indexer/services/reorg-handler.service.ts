import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, MoreThanOrEqual } from 'typeorm';
import { BlockchainEvent } from '../entities/blockchain-event.entity';
import { IndexedEvent } from '../entities/indexed-event.entity';
import { IndexingStateService } from './indexing-state.service';
import { StellarEventSourceService } from './stellar-event-source.service';
import { EventNormalizer } from './event-normalizer.service';
import {
  BatchedPersistenceService,
  IndexedEventInput,
} from './batched-persistence.service';

/**
 * Detects and recovers from Stellar ledger reorganizations.
 *
 * Ledger sequence numbers are strictly monotonic, so `current < lastIndexed`
 * can never happen. The only reliable signal is the **hash**: if the on-chain
 * hash at `lastIndexedLedger` no longer matches the hash persisted when that
 * ledger was indexed, the ledger was rolled back and every event derived from
 * it (and later ledgers) is invalid.
 *
 * Recovery:
 * 1. Mark rows in both `IndexedEvent` and `BlockchainEvent` invalidated from
 *    the fork point onwards.
 * 2. Rewind `last_indexed_ledger` to just before the fork.
 * 3. Re-fetch and persist the affected ledgers, advancing the cursor only
 *    after the replacement events have been committed.
 */
@Injectable()
export class ReorgHandlerService {
  private readonly logger = new Logger(ReorgHandlerService.name);
  private readonly maxBackfillLedgers: number;

  private lastCheckAt: Date | null = null;
  private lastReorgDetectedAt: Date | null = null;
  private reorgCount = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: IndexingStateService,
    private readonly eventSource: StellarEventSourceService,
    private readonly normalizer: EventNormalizer,
    private readonly persistence: BatchedPersistenceService,
    private readonly configService: ConfigService,
  ) {
    this.maxBackfillLedgers =
      this.configService.get<number>('blockchainIndexer.maxBackfillLedgers') ??
      1000;
  }

  /**
   * Runs a single reorg check. Returns true when a reorg was detected and
   * recovery was applied, false otherwise.
   */
  async detectAndHandle(): Promise<boolean> {
    this.lastCheckAt = new Date();

    const currentLedger = await this.eventSource.getLatestLedgerSequence();
    const lastIndexedLedger = await this.stateService.getLastIndexedLedger();

    if (lastIndexedLedger === null) {
      return false;
    }

    const storedHash = await this.stateService.getLastIndexedLedgerHash();

    if (storedHash) {
      const onChainLedger = await this.eventSource.getLedger(lastIndexedLedger);

      if (onChainLedger === null) {
        // Horizon no longer knows the ledger we indexed: we are ahead of the
        // canonical chain, which is a reorg.
        this.logger.warn(
          `Reorg detected: ledger ${lastIndexedLedger} is no longer known to Horizon`,
        );
        await this.recoverFromReorg(lastIndexedLedger, currentLedger);
        return true;
      }

      if (onChainLedger.hash !== storedHash) {
        this.logger.warn(
          `Reorg detected at ledger ${lastIndexedLedger}: stored hash ${storedHash} != on-chain hash ${onChainLedger.hash}`,
        );
        await this.recoverFromReorg(lastIndexedLedger, currentLedger);
        return true;
      }

      this.logger.debug(
        `Reorg check passed at ledger ${lastIndexedLedger} (hash ${storedHash})`,
      );
    }

    const gap = currentLedger - lastIndexedLedger;
    if (gap > this.maxBackfillLedgers) {
      this.logger.warn(
        `Large indexing gap detected: ${gap} ledgers between ${lastIndexedLedger} and ${currentLedger}. Triggering bounded backfill.`,
      );
      // Bound the work: the next scheduled check will continue the backfill.
      await this.backfillGap(
        lastIndexedLedger + 1,
        Math.min(currentLedger, lastIndexedLedger + this.maxBackfillLedgers),
      );
    } else if (gap > 0) {
      this.logger.debug(
        `Small gap of ${gap} ledgers detected; main indexer will catch up naturally.`,
      );
    }

    return false;
  }

  getStats() {
    return {
      lastCheckAt: this.lastCheckAt,
      lastReorgDetectedAt: this.lastReorgDetectedAt,
      reorgCount: this.reorgCount,
      maxBackfillLedgers: this.maxBackfillLedgers,
    };
  }

  private async recoverFromReorg(
    forkLedger: number,
    currentLedger: number,
  ): Promise<void> {
    this.reorgCount++;
    this.lastReorgDetectedAt = new Date();

    await this.invalidateEventsFromLedger(forkLedger);

    // Rewind so the replacement ledger is re-indexed. Clearing the hash
    // prevents a second mismatch against the stale value before that happens.
    const rewindTo = Math.max(forkLedger - 1, 0);
    await this.stateService.setLastIndexedLedger(rewindTo, null);

    const toLedger = Math.min(
      currentLedger,
      forkLedger + this.maxBackfillLedgers - 1,
    );

    try {
      await this.backfillGap(forkLedger, toLedger);
    } catch (error) {
      this.logger.error(
        `Reorg recovery backfill failed for ledgers ${forkLedger}-${toLedger}: ${(error as Error).message}`,
      );
    }
  }

  private async invalidateEventsFromLedger(fromLedger: number): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const indexed = await manager
          .getRepository(IndexedEvent)
          .update(
            { ledgerSequence: MoreThanOrEqual(fromLedger), invalidated: false },
            { invalidated: true },
          );

        const legacy = await manager
          .getRepository(BlockchainEvent)
          .update(
            { ledger: MoreThanOrEqual(fromLedger), invalidated: false },
            { invalidated: true },
          );

        this.logger.log(
          `Invalidated ${indexed.affected ?? 0} indexed event(s) and ${legacy.affected ?? 0} legacy event(s) from ledger ${fromLedger}`,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to invalidate events from ledger ${fromLedger}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Failed to invalidate events');
    }
  }

  /**
   * Fetches, normalizes and persists every event in the given ledger range,
   * then advances `last_indexed_ledger` to `toLedger`.
   *
   * Unlike the previous implementation, the fetched operations are actually
   * persisted and the cursor moves forward, so a large gap is closed once
   * instead of being re-fetched on every check.
   */
  private async backfillGap(
    fromLedger: number,
    toLedger: number,
  ): Promise<void> {
    if (toLedger < fromLedger) return;

    this.logger.log(`Backfilling ledgers ${fromLedger} through ${toLedger}`);

    try {
      const transactions = await this.eventSource.getTransactionsByLedgerRange(
        fromLedger,
        toLedger,
      );

      this.logger.log(
        `Fetched ${transactions.length} transactions for backfill`,
      );

      // The normalizer may not have been initialized yet when the startup
      // reorg check runs, and during live operation its counter is ahead of
      // the persisted value. Never move it backwards.
      const persistedCounter = await this.stateService.getSequenceCounter();
      if (this.normalizer.getCurrentSequence() < persistedCounter) {
        this.normalizer.initializeSequenceCounter(persistedCounter);
      }

      const events: IndexedEventInput[] = [];
      for (const tx of transactions) {
        if (!tx.successful) continue;

        let operations;
        try {
          operations = await this.eventSource.getOperationsForTransaction(
            tx.hash,
          );
        } catch {
          this.logger.warn(
            `Backfill: failed to fetch operations for tx ${tx.hash}`,
          );
          continue;
        }

        for (const event of this.normalizer.normalizeStellarOperations(
          tx,
          operations,
        )) {
          events.push(this.normalizer.assignSequence(event));
        }
      }

      if (events.length > 0) {
        this.persistence.enqueueBatch(events);
        await this.persistence.flush();
      }

      // Advance the cursor only after the replacement events are committed.
      const lastLedger = await this.eventSource.getLedger(toLedger);
      await this.stateService.setLastIndexedLedger(
        toLedger,
        lastLedger?.hash ?? null,
      );

      this.logger.log(
        `Backfill complete for ledgers ${fromLedger}-${toLedger} (${events.length} events persisted); cursor advanced to ${toLedger}`,
      );
    } catch (error) {
      this.logger.error(
        `Backfill failed for range ${fromLedger}-${toLedger}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Backfill failed');
    }
  }
}
