import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarRequestQueueService } from './stellar-request-queue.service';

describe('StellarRequestQueueService', () => {
  let service: StellarRequestQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarRequestQueueService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'stellar.maxQueueSize': 100,
                'stellar.maxConcurrentRequests': 5,
                'stellar.processingIntervalMs': 50,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarRequestQueueService>(StellarRequestQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return queue stats', () => {
    const stats = service.getQueueStats();
    expect(stats).toBeDefined();
    expect(stats.maxQueueSize).toBe(100);
    expect(stats.maxConcurrentRequests).toBe(5);
    expect(stats.queueLength).toBe(0);
    expect(stats.activeRequests).toBe(0);
  });

  it('should enqueue requests', async () => {
    const promise = service.enqueue('test-client', async () => 'test-result');
    const stats = service.getQueueStats();
    expect(stats.queueLength).toBe(1);
    
    // Wait for processing
    const result = await promise;
    expect(result).toBe('test-result');
  });

  it('should clear queue', () => {
    service.enqueue('test-client', async () => 'test');
    const cleared = service.clearQueue();
    expect(cleared).toBeGreaterThan(0);
    
    const stats = service.getQueueStats();
    expect(stats.queueLength).toBe(0);
  });
});