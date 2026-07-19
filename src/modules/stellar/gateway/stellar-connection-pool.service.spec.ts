import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarConnectionPoolService } from './stellar-connection-pool.service';

describe('StellarConnectionPoolService', () => {
  let service: StellarConnectionPoolService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarConnectionPoolService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
                'stellar.poolMinConnections': 2,
                'stellar.poolMaxConnections': 10,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarConnectionPoolService>(StellarConnectionPoolService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return pool stats', () => {
    const stats = service.getPoolStats();
    expect(stats).toBeDefined();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.config.minConnections).toBe(2);
  });

  it('should acquire and release connections', async () => {
    const connection = await service.acquireConnection();
    expect(connection).toBeDefined();
    expect(connection.inUse).toBe(true);
    
    service.releaseConnection(connection.id);
    
    const stats = service.getPoolStats();
    expect(stats.idle).toBeGreaterThan(0);
  });
});