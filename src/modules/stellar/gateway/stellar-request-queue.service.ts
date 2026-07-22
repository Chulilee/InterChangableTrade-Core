import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  addedAt: Date;
  clientId: string;
}

interface QueueConfig {
  maxQueueSize: number;
  maxConcurrentRequests: number;
  processingIntervalMs: number;
}

@Injectable()
export class StellarRequestQueueService {
  private readonly logger = new Logger(StellarRequestQueueService.name);
  private queue: QueuedRequest<any>[] = [];
  private activeRequests: number = 0;
  private readonly config: QueueConfig;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      maxQueueSize:
        this.configService.get<number>('stellar.maxQueueSize') ?? 100,
      maxConcurrentRequests:
        this.configService.get<number>('stellar.maxConcurrentRequests') ?? 5,
      processingIntervalMs:
        this.configService.get<number>('stellar.processingIntervalMs') ?? 50,
    };

    this.logger.log(
      `Stellar request queue initialized: max=${this.config.maxQueueSize}, concurrent=${this.config.maxConcurrentRequests}`,
    );
    this.startProcessing();
  }

  enqueue<T>(clientId: string, execute: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      this.logger.error(
        `Queue overflow: ${this.queue.length}/${this.config.maxQueueSize} requests`,
      );
      throw new ServiceUnavailableException(
        'Stellar request queue is full. Please try again later.',
      );
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        execute,
        resolve,
        reject,
        addedAt: new Date(),
        clientId,
      };

      this.queue.push(request);
      this.logger.debug(
        `Queued request ${request.id} for client ${clientId}, queue size: ${this.queue.length}`,
      );
    });
  }

  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, this.config.processingIntervalMs);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (
        this.queue.length > 0 &&
        this.activeRequests < this.config.maxConcurrentRequests
      ) {
        const request = this.queue.shift();
        if (!request) break;

        this.activeRequests++;
        this.logger.debug(
          `Processing request ${request.id}, active: ${this.activeRequests}, queue remaining: ${this.queue.length}`,
        );

        this.executeRequest(request).finally(() => {
          this.activeRequests--;
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
    const waitTime = Date.now() - request.addedAt.getTime();
    this.logger.debug(
      `Executing request ${request.id} after ${waitTime}ms wait`,
    );

    try {
      const result = await request.execute();
      request.resolve(result);
      this.logger.debug(
        `Request ${request.id} completed successfully in ${Date.now() - request.addedAt.getTime()}ms`,
      );
    } catch (error) {
      request.reject(error as Error);
      this.logger.error(
        `Request ${request.id} failed: ${(error as Error).message}`,
      );
    }
  }

  getQueueStats(): {
    queueLength: number;
    activeRequests: number;
    maxQueueSize: number;
    maxConcurrentRequests: number;
  } {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      maxQueueSize: this.config.maxQueueSize,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
    };
  }

  clearQueue(): number {
    const clearedCount = this.queue.length;
    this.queue.forEach((request) => {
      request.reject(
        new ServiceUnavailableException('Queue cleared by administrator'),
      );
    });
    this.queue = [];
    this.logger.log(`Queue cleared, ${clearedCount} requests rejected`);
    return clearedCount;
  }

  onDestroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.clearQueue();
  }
}
