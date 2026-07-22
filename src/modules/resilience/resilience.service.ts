import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IPolicy,
  RetryPolicy,
  CircuitBreakerPolicy,
  FallbackPolicy,
  pipeline,
  ExponentialBackoffWithJitter,
  MemoryStateStore,
  RetryEventArgs,
} from 'polly-ts-core';
import { Redis } from 'ioredis';
import { ApiError } from '../error-handler/errors';

@Injectable()
export class ResilienceService {
  public readonly resilientPipeline: IPolicy;
  private readonly logger = new Logger(ResilienceService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
    const retryPolicy = new RetryPolicy<any>({
      maxAttempts: 3,
      backoff: new ExponentialBackoffWithJitter({ initialDelay: 100 }),
      shouldRetryError: (err: Error) => err instanceof ApiError,
    });
    retryPolicy.onRetry(({ error, attemptNumber }: RetryEventArgs) => {
      if (error) {
        this.logger.warn(
          `Retrying operation, attempt ${attemptNumber}. Error: ${error.message}`,
        );
      }
    });

    const circuitBreakerPolicy = new CircuitBreakerPolicy({
      stateStore: new MemoryStateStore(5, 30000, 3),
      shouldHandle: (err: Error) => err instanceof ApiError,
    });

    const fallbackPolicy: IPolicy = new FallbackPolicy<any>({
      fallback: (err: Error) => {
        this.logger.warn(
          `Fallback triggered due to: ${err.message}. Service is temporarily unavailable.`,
        );
        return {
          name: 'InterChangableTrade Core API',
          status: 'degraded',
        };
      },
    });

    this.resilientPipeline = pipeline(
      fallbackPolicy,
      retryPolicy,
      circuitBreakerPolicy,
    );
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.resilientPipeline.execute(() => fn());
  }
}
