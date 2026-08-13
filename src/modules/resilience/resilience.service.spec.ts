import { Test, TestingModule } from '@nestjs/testing';
import { ResilienceService } from './resilience.service';
import { ApiError } from '../error-handler/errors';
import { CircuitOpenError } from 'polly-ts-core';

describe('ResilienceService', () => {
  let service: ResilienceService;

  beforeEach(async () => {
    // ResilienceService injects REDIS_CLIENT but does not use it (the circuit
    // breaker keeps state in-memory via MemoryStateStore), so a bare stub keeps
    // this suite hermetic — no live Redis or environment file required.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResilienceService,
        {
          provide: 'REDIS_CLIENT',
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ResilienceService>(ResilienceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should retry on ApiError', async () => {
    const mockFn = jest.fn();
    mockFn.mockRejectedValueOnce(new ApiError('API Error'));
    mockFn.mockResolvedValueOnce('Success');

    const result = await service.execute(mockFn);

    expect(result).toBe('Success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should open circuit breaker after failures', async () => {
    const mockFn = jest.fn();
    mockFn.mockRejectedValue(new ApiError('API Error'));

    for (let i = 0; i < 5; i++) {
      await expect(service.execute(mockFn)).rejects.toThrow(ApiError);
    }

    // Circuit should be open now
    await expect(service.execute(mockFn)).rejects.toThrow(CircuitOpenError);
  });

  it('should fallback after failures', async () => {
    const mockFn = jest.fn();
    mockFn.mockRejectedValue(new Error('Some other error'));

    const result = await service.execute(mockFn);

    expect(result).toEqual({
      name: 'InterChangableTrade Core API',
      status: 'degraded',
    });
  });
});
