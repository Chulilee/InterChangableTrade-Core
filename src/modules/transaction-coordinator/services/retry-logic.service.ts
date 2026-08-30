import { Injectable, Logger } from '@nestjs/common';

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (cap) */
  maxDelayMs: number;
  /** Jitter factor (0-1, 0 = no jitter, 1 = full jitter) */
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
};

export interface RetryAttempt {
  attemptNumber: number;
  delayMs: number;
  error: Error;
  timestamp: Date;
}

/**
 * Implements exponential backoff with jitter for transient failure recovery.
 *
 * Uses a decorrelated jitter algorithm that prevents thundering herd
 * problems when multiple batches retry simultaneously. The algorithm:
 *
 * delay = min(maxDelay, baseDelay * 2^attempt) + random(0, jitter * delay)
 */
@Injectable()
export class RetryLogicService {
  private readonly logger = new Logger(RetryLogicService.name);

  /**
   * Execute an operation with retry logic.
   * Returns the result on success, or throws the last error after all retries.
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    context?: string,
  ): Promise<T> {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    const retryHistory: RetryAttempt[] = [];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        if (!this.isRetryableError(lastError)) {
          this.logger.debug(
            `${context ?? 'Operation'}: non-retryable error, aborting: ${lastError.message}`,
          );
          throw lastError;
        }

        // If this was the last attempt, throw
        if (attempt === fullConfig.maxRetries) {
          this.logger.warn(
            `${context ?? 'Operation'}: exhausted ${fullConfig.maxRetries} retries`,
          );
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, fullConfig);

        retryHistory.push({
          attemptNumber: attempt + 1,
          delayMs: delay,
          error: lastError,
          timestamp: new Date(),
        });

        this.logger.debug(
          `${context ?? 'Operation'}: retry ${attempt + 1}/${fullConfig.maxRetries} after ${delay}ms (${lastError.message})`,
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Calculate the delay for a given retry attempt using exponential backoff
   * with decorrelated jitter.
   *
   * Formula: delay = min(maxDelay, base * 2^attempt) + random(0, jitter * base * 2^attempt)
   */
  calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    const jitterRange = cappedDelay * config.jitterFactor;
    const jitter = Math.random() * jitterRange;
    return Math.round(cappedDelay + jitter);
  }

  /**
   * Determine if an error is transient and worth retrying.
   * Network errors, timeouts, and rate limits are retryable.
   * Contract errors and validation errors are not.
   */
  isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network/transport errors — retryable
    const retryablePatterns = [
      'timeout',
      'timed out',
      'econnrefused',
      'econnreset',
      'enotfound',
      'network',
      'socket',
      'fetch failed',
      'getaddrinfo',
      'service unavailable',
      'bad gateway',
      'gateway timeout',
      'request failed with status code 429',
      'rate limit',
      'too many requests',
      'resource temporarily unavailable',
      'eagain',
      'econnaborted',
    ];

    if (retryablePatterns.some((p) => message.includes(p))) {
      return true;
    }

    // Check for transient HTTP status codes embedded in message
    if (message.includes('status code 5')) {
      return true; // 5xx errors
    }

    // Check error type/class patterns
    const retryableNames = [
      'networkerror',
      'timeouterror',
      'fetcherror',
      'systemerror',
    ];
    if (retryableNames.some((n) => name.includes(n))) {
      return true;
    }

    return false;
  }

  /**
   * Get a summary of retry attempts for logging/audit.
   */
  getRetrySummary(retryHistory: RetryAttempt[]): {
    totalAttempts: number;
    totalDelayMs: number;
    errors: string[];
    duration: number;
  } {
    const totalAttempts = retryHistory.length;
    const totalDelayMs = retryHistory.reduce((sum, r) => sum + r.delayMs, 0);
    const errors = retryHistory.map((r) => r.error.message);
    const duration =
      retryHistory.length > 0
        ? retryHistory[retryHistory.length - 1].timestamp.getTime() -
          retryHistory[0].timestamp.getTime()
        : 0;

    return { totalAttempts, totalDelayMs, errors, duration };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
