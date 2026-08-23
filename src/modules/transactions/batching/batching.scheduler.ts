import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { BatchingService } from './batching.service';

const TICK_INTERVAL_MS = 1_000;

/**
 * Drives the time-based batching trigger. Every second it asks the batching
 * service to evaluate the pending queue; execution itself only happens once
 * the configured window (default 30s) or size threshold (default 50) is hit.
 */
@Injectable()
export class BatchingScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BatchingScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly batchingService: BatchingService) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.batchingService.onTick().catch((error) => {
        this.logger.error(
          `Batch tick failed: ${error instanceof Error ? error.message : error}`,
        );
      });
    }, TICK_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
