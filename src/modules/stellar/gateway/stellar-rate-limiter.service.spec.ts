import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarRateLimiterService } from './stellar-rate-limiter.service';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('StellarRateLimiterService', () => {
  let service: StellarRateLimiterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarRateLimiterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'stellar.rateLimitPerMinute': 60,
                'stellar.rateBurstLimit': 10,
                'stellar.rateLimitEnabled': true,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarRateLimiterService>(StellarRateLimiterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return rate limit config', () => {
    const config = service.getRateLimitConfig();
    expect(config).toBeDefined();
    expect(config.requestsPerMinute).toBe(60);
    expect(config.burstLimit).toBe(10);
    expect(config.enabled).toBe(true);
  });

  it('should allow requests within limits', () => {
    expect(() => {
      service.checkRateLimit('test-client');
    }).not.toThrow();
  });

  it('should return client limits when set', () => {
    service.checkRateLimit('test-client-2');
    const limit = service.getClientLimit('test-client-2');
    expect(limit).toBeDefined();
    expect(limit?.requests).toBe(1);
  });
});