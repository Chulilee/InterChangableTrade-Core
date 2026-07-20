import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PoolMonitorService } from './pool-monitor.service';

describe('PoolMonitorService', () => {
  let service: PoolMonitorService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn(),
      driver: {
        options: {
          extra: {
            totalCount: 10,
            idleCount: 5,
            waitingCount: 0,
          },
        },
      } as any,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoolMonitorService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get(PoolMonitorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCurrentMetrics', () => {
    it('should return current pool metrics', () => {
      const metrics = service.getCurrentMetrics();

      expect(metrics.total).toBe(10);
      expect(metrics.idle).toBe(5);
      expect(metrics.active).toBe(5);
      expect(metrics.utilizationPercent).toBe(50);
    });
  });

  describe('getDetailedMetrics', () => {
    it('should return detailed metrics from database', async () => {
      mockDataSource.query.mockResolvedValue([
        {
          total: '15',
          idle: '8',
          active: '5',
          waiting: '2',
        },
      ]);

      const metrics = await service.getDetailedMetrics();

      expect(metrics.total).toBe(15);
      expect(metrics.idle).toBe(8);
      expect(metrics.active).toBe(5);
      expect(metrics.waiting).toBe(2);
    });

    it('should fallback to basic metrics on database error', async () => {
      mockDataSource.query.mockRejectedValue(new Error('Query failed'));

      const metrics = await service.getDetailedMetrics();

      expect(metrics.total).toBe(10);
    });
  });

  describe('getRecommendations', () => {
    it('should recommend increasing pool size when utilization is high', () => {
      const metrics = {
        total: 10,
        idle: 1,
        active: 9,
        waiting: 0,
        utilizationPercent: 90,
        timestamp: new Date(),
      };

      const recommendations = service.getRecommendations();

      expect(recommendations.some((r: string) => r.includes('pool utilization') || r.includes('connection pool'))).toBe(true);
    });

    it('should recommend optimizing queries when connections are waiting', () => {
      Object.defineProperty(mockDataSource.driver.options, 'extra', {
        value: {
          totalCount: 10,
          idleCount: 8,
          waitingCount: 3,
        },
        writable: true,
      });

      const recommendations = service.getRecommendations();

      expect(recommendations.some((r: string) => r.includes('waiting'))).toBe(true);
    });
  });

  describe('getAverageUtilization', () => {
    it('should return average utilization from history', () => {
      service['recordMetrics']();

      const avg = service.getAverageUtilization();

      expect(typeof avg).toBe('number');
    });

    it('should return 0 when no metrics recorded', () => {
      const avg = service.getAverageUtilization();

      expect(avg).toBe(0);
    });
  });
});
