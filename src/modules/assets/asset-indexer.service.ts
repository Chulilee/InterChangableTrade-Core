import { Injectable, Logger } from '@nestjs/common';
import { AssetsService } from './assets.service';

/**
 * Scaffold for the background asset indexer. In a full implementation this
 * would page through Horizon's `/assets` endpoint (or ingest Soroban events)
 * and feed each record into `AssetsService.upsert`.
 *
 * The public method is intentionally driver-agnostic so it can be wired to a
 * cron schedule, a queue worker, or a manual admin trigger later without
 * changing the persistence contract.
 */
@Injectable()
export class AssetIndexerService {
  private readonly logger = new Logger(AssetIndexerService.name);

  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Runs a single indexing pass. Returns the number of assets processed.
   * Currently a no-op placeholder that logs intent; the Horizon integration
   * lands with the Stellar module.
   */
  async runIndexingPass(): Promise<number> {
    this.logger.log('Starting asset indexing pass');
    // TODO: fetch assets from Horizon and upsert each via assetsService.
    const processed = 0;
    this.logger.log(`Indexing pass complete: ${processed} assets processed`);
    return processed;
  }
}
