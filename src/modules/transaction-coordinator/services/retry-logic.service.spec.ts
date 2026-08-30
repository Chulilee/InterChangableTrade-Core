import { RetryLogicService } from './retry-logic.service';

describe('RetryLogicService', () => {
  let service: RetryLogicService;

  beforeEach(() => {
    service = new RetryLogicService();
  });

  describe('executeWithRetry', () => {
    it('should return result on first successful attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await service.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(operation, {
        maxRetries: 3,
        baseDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should exhaust retries and throw', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.executeWithRetry(operation, {
          maxRetries: 2,
          baseDelayMs: 10,
        }),
      ).rejects.toThrow('ECONNREFUSED');

      // Initial attempt + 2 retries = 3 calls total
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new Error('Contract assertion failed'));

      await expect(
        service.executeWithRetry(operation, {
          maxRetries: 3,
          baseDelayMs: 10,
        }),
      ).rejects.toThrow('Contract assertion failed');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on timeout errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Request timed out'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(operation, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Request failed with status code 503'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(operation, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on rate limit errors', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Too many requests'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(operation, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('calculateDelay', () => {
    it('should use exponential backoff', () => {
      const config = {
        maxRetries: 5,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        jitterFactor: 0,
      };

      // With no jitter, delay should be base * 2^attempt
      const delay0 = service.calculateDelay(0, config);
      expect(delay0).toBe(100); // 100 * 2^0

      const delay1 = service.calculateDelay(1, config);
      expect(delay1).toBe(200); // 100 * 2^1

      const delay2 = service.calculateDelay(2, config);
      expect(delay2).toBe(400); // 100 * 2^2

      const delay3 = service.calculateDelay(3, config);
      expect(delay3).toBe(800); // 100 * 2^3
    });

    it('should cap at maxDelayMs', () => {
      const config = {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        jitterFactor: 0,
      };

      const delay = service.calculateDelay(10, config);
      expect(delay).toBe(5000);
    });

    it('should add jitter when jitterFactor > 0', () => {
      const config = {
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0.3,
      };

      // Run multiple times to verify jitter adds randomness
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(service.calculateDelay(2, config));
      }

      // With jitter, we should get some variation
      // Base would be 4000, jitter range is 1200, so delay should be 4000-5200
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(4000);
        expect(delay).toBeLessThanOrEqual(5200);
      }
    });
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      expect(service.isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(service.isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(service.isRetryableError(new Error('ENOTFOUND'))).toBe(true);
      expect(service.isRetryableError(new Error('Request timed out'))).toBe(
        true,
      );
    });

    it('should identify HTTP 5xx as retryable', () => {
      expect(
        service.isRetryableError(
          new Error('Request failed with status code 500'),
        ),
      ).toBe(true);
      expect(
        service.isRetryableError(
          new Error('Request failed with status code 503'),
        ),
      ).toBe(true);
    });

    it('should identify rate limit as retryable', () => {
      expect(service.isRetryableError(new Error('Too many requests'))).toBe(
        true,
      );
      expect(service.isRetryableError(new Error('rate limit exceeded'))).toBe(
        true,
      );
    });

    it('should not mark contract errors as retryable', () => {
      expect(
        service.isRetryableError(new Error('Contract assertion failed')),
      ).toBe(false);
      expect(
        service.isRetryableError(new Error('HostFunctionError: trap')),
      ).toBe(false);
    });

    it('should not mark validation errors as retryable', () => {
      expect(
        service.isRetryableError(
          new Error('Invalid argument: missing required field'),
        ),
      ).toBe(false);
    });
  });

  describe('getRetrySummary', () => {
    it('should compute correct summary from retry history', () => {
      const history = [
        {
          attemptNumber: 1,
          delayMs: 100,
          error: new Error('ECONNREFUSED'),
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          attemptNumber: 2,
          delayMs: 200,
          error: new Error('ECONNRESET'),
          timestamp: new Date('2026-01-01T00:00:00.300Z'),
        },
      ];

      const summary = service.getRetrySummary(history);

      expect(summary.totalAttempts).toBe(2);
      expect(summary.totalDelayMs).toBe(300);
      expect(summary.errors).toEqual(['ECONNREFUSED', 'ECONNRESET']);
    });

    it('should handle empty history', () => {
      const summary = service.getRetrySummary([]);

      expect(summary.totalAttempts).toBe(0);
      expect(summary.totalDelayMs).toBe(0);
      expect(summary.errors).toHaveLength(0);
      expect(summary.duration).toBe(0);
    });
  });
});
