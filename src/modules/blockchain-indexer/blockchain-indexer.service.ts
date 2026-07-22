import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { IndexingStateService } from './services/indexing-state.service';
import { ReorgHandlerService } from './services/reorg-handler.service';
import { EventIndexerService } from './services/event-indexer.service';
import { StellarEventSourceService } from './services/stellar-event-source.service';
import { EventQueryService } from './services/event-query.service';
import { EventStreamService } from './services/event-stream.service';

@Injectable()
export class BlockchainIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainIndexerService.name);

  constructor(
    private readonly eventSource: StellarEventSourceService,
    private readonly stateService: IndexingStateService,
    private readonly reorgHandler: ReorgHandlerService,
    private readonly eventIndexer: EventIndexerService,
    private readonly queryService: EventQueryService,
    private readonly streamService: EventStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    this.logger.log('Starting blockchain event indexing module');
    await this.reorgHandler.detectAndHandle();
    await this.eventIndexer.start();
    this.logger.log('Blockchain event indexing module started');
  }

  async stop(): Promise<void> {
    this.logger.log('Stopping blockchain event indexing module');
    await this.eventIndexer.stop();
    this.logger.log('Blockchain event indexing module stopped');
  }

  onModuleDestroy(): void {
    void this.stop();
  }

  async getStatus() {
    return {
      indexing: true,
      lastIndexedLedger: await this.stateService.getLastIndexedLedger(),
      pollIntervalMs: this.eventSource.getPollIntervalMs(),
    };
  }
}
