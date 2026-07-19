import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarConnectionPoolService } from './stellar-connection-pool.service';
import { StellarRateLimiterService } from './stellar-rate-limiter.service';
import { StellarRequestQueueService } from './stellar-request-queue.service';
import { StellarApiGatewayService } from './stellar-api-gateway.service';

describe('StellarApiGatewayService', () => {
  let service: StellarApiGatewayService;
  let connectionPool: StellarConnectionPoolService;
  let rateLimiter: StellarRateLimiterService;
  let requestQueue: StellarRequestQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarApiGatewayService,
        StellarConnectionPoolService,
        StellarRateLimiterService,
        StellarRequestQueueService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
                'stellar.networkPassphrase': 'Test SDF Network ; September 2015',
                'stellar.network': 'testnet',
                'stellar.poolMinConnections': 2,
                'stellar.poolMaxConnections': 10,
                'stellar.rateLimitPerMinute': 60,
                'stellar.rateBurstLimit': 10,
                'stellar.maxQueueSize': 100,
                'stellar.maxConcurrentRequests': 5,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarApiGatewayService>(StellarApiGatewayService);
    connectionPool = module.get<StellarConnectionPoolService>(StellarConnectionPoolService);
    rateLimiter = module.get<StellarRateLimiterService>(StellarRateLimiterService);
    requestQueue = module.get<StellarRequestQueueService>(StellarRequestQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return network info', () => {
    const networkInfo = service.getNetworkInfo();
    expect(networkInfo).toBeDefined();
    expect(networkInfo.network).toBe('testnet');
  });

  it('should return gateway stats', () => {
    const stats = service.getGatewayStats();
    expect(stats).toBeDefined();
    expect(stats.pool).toBeDefined();
    expect(stats.queue).toBeDefined();
    expect(stats.rateLimit).toBeDefined();
  });
});