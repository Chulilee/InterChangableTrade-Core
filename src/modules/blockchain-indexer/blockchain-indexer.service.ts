import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndexingStateService } from './services/indexing-state.service';
import { ReorgHandlerService } from './services/reorg-handler.service';
import { EventIndexerService } from './services/event-indexer.service';
import { StellarEventSourceService } from './services/stellar-event-source.service';
import { EventQueryService } from './services/event-query.service';
import { EventStreamService } from './services/event-stream.service';

@Injectable()
export class BlockchainIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainIndexerService.name);
  private readonly reorgCheckIntervalMs: number;

  private reorgTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventSource: StellarEventSourceService,
    private readonly stateService: IndexingStateService,
    private readonly reorgHandler: ReorgHandlerService,
    private readonly eventIndexer: EventIndexerService,
    private readonly queryService: EventQueryService,
    private readonly streamService: EventStreamService,
    private readonly configService: ConfigService,
  ) {
    this.reorgCheckIntervalMs =
      this.configService.get<number>(
        'blockchainIndexer.reorgCheckIntervalMs',
      ) ?? 300000;
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    this.logger.log('Starting blockchain event indexing module');
    try {
      await this.reorgHandler.detectAndHandle();
    } catch (error) {
      this.logger.warn(
        `Initial reorg check skipped: ${(error as Error).message}`,
      );
    }
    await this.eventIndexer.start();
    this.scheduleReorgChecks();
    this.logger.log(
      `Blockchain event indexing module started (reorg check every ${this.reorgCheckIntervalMs}ms)`,
    );
  }

  async stop(): Promise<void> {
    this.logger.log('Stopping blockchain event indexing module');
    if (this.reorgTimer) {
      clearInterval(this.reorgTimer);
      this.reorgTimer = null;
    }
    await this.eventIndexer.stop();
    this.logger.log('Blockchain event indexing module stopped');
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Runs reorg detection immediately and reports the outcome. Used by the
   * admin endpoint so operators can force a check on demand.
   */
  async triggerReorgCheck(): Promise<{
    reorgDetected: boolean;
    lastIndexedLedger: number | null;
    stats: ReturnType<ReorgHandlerService['getStats']>;
  }> {
    const reorgDetected = await this.reorgHandler.detectAndHandle();
    return {
      reorgDetected,
      lastIndexedLedger: await this.stateService.getLastIndexedLedger(),
      stats: this.reorgHandler.getStats(),
    };
  }

  async getStatus() {
    return {
      indexing: true,
      lastIndexedLedger: await this.stateService.getLastIndexedLedger(),
      pollIntervalMs: this.eventSource.getPollIntervalMs(),
      reorg: this.reorgHandler.getStats(),
    };
  }

  private scheduleReorgChecks(): void {
    if (this.reorgTimer || this.reorgCheckIntervalMs <= 0) return;

    this.reorgTimer = setInterval(() => {
      void this.runScheduledReorgCheck();
    }, this.reorgCheckIntervalMs);
    this.reorgTimer.unref?.();
  }

  private async runScheduledReorgCheck(): Promise<void> {
    try {
      const detected = await this.reorgHandler.detectAndHandle();
      if (detected) {
        this.logger.warn('Scheduled reorg check detected and recovered a reorg');
      }
    } catch (error) {
      this.logger.warn(
        `Scheduled reorg check failed: ${(error as Error).message}`,
      );
    }
  }
}
