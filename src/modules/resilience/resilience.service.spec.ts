import { Test, TestingModule } from '@nestjs/testing';
import { ResilienceService } from './resilience.service';
import { ApiError } from '../error-handler/errors';
import { RedisModule } from '../../redis/redis.module';
import { ConfigModule } from '@nestjs/config';
import { Redis } from 'ioredis';
import { CircuitOpenError } from 'polly-ts-core';

describe('ResilienceService', () => {
  let service: ResilienceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        RedisModule,
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [
        ResilienceService,
        {
          provide: 'REDIS_CLIENT',
          useValue: new Redis(),
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
