import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, LessThanOrEqual, MoreThan, MoreThanOrEqual } from 'typeorm';
import { BlockchainEvent } from '../entities/blockchain-event.entity';
import { IndexingStateService } from './indexing-state.service';
import { StellarEventSourceService } from './stellar-event-source.service';

@Injectable()
export class ReorgHandlerService {
  private readonly logger = new Logger(ReorgHandlerService.name);
  private readonly maxBackfillLedgers: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly stateService: IndexingStateService,
    private readonly eventSource: StellarEventSourceService,
    private readonly configService: ConfigService,
  ) {
    this.maxBackfillLedgers =
      this.configService.get<number>('blockchainIndexer.maxBackfillLedgers') ??
      1000;
  }

  async detectAndHandle(): Promise<boolean> {
    const currentLedger = await this.eventSource.getLatestLedgerSequence();
    const lastIndexedLedger = await this.stateService.getLastIndexedLedger();

    if (lastIndexedLedger === null) {
      return false;
    }

    if (currentLedger < lastIndexedLedger) {
      this.logger.warn(
        `Reorg detected: current ledger ${currentLedger} < last indexed ${lastIndexedLedger}. Invalidating events from ${currentLedger + 1}.`,
      );
      await this.invalidateEventsFromLedger(currentLedger + 1);
      await this.stateService.setLastIndexedLedger(currentLedger);
      return true;
    }

    const gap = currentLedger - lastIndexedLedger;
    if (gap > this.maxBackfillLedgers) {
      this.logger.warn(
        `Large indexing gap detected: ${gap} ledgers between ${lastIndexedLedger} and ${currentLedger}. Triggering backfill.`,
      );
      await this.backfillGap(lastIndexedLedger + 1, currentLedger);
    } else if (gap > 0) {
      this.logger.debug(
        `Small gap of ${gap} ledgers detected; main indexer will catch up naturally.`,
      );
    }

    return false;
  }

  private async invalidateEventsFromLedger(fromLedger: number): Promise<void> {
    try {
      await this.dataSource
        .getRepository(BlockchainEvent)
        .update(
          { ledger: MoreThanOrEqual(fromLedger), invalidated: false },
          { invalidated: true },
        );
      this.logger.log(`Invalidated events from ledger ${fromLedger}`);
    } catch (error) {
      this.logger.error(
        `Failed to invalidate events from ledger ${fromLedger}: ${(error as Error).message}`,
      );
    }
  }

  private async backfillGap(fromLedger: number, toLedger: number): Promise<void> {
    this.logger.log(`Backfilling ledgers ${fromLedger} through ${toLedger}`);
    try {
      const transactions = await this.eventSource.getTransactionsByLedgerRange(
        fromLedger,
        toLedger,
      );
      this.logger.log(`Fetched ${transactions.length} transactions for backfill`);
      for (const tx of transactions) {
        await this.eventSource.getOperationsForTransaction(tx.hash);
      }
    } catch (error) {
      this.logger.error(
        `Backfill failed for range ${fromLedger}-${toLedger}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Backfill failed');
    }
  }
}
