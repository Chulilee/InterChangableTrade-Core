import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from './entities/analytics-metric.entity';
import { SavedReport, ReportType, ReportFormat, ReportStatus } from './entities/saved-report.entity';
import { UserSegment, SegmentType } from './entities/user-segment.entity';
import { MetricsCollectorService } from './services/metrics-collector.service';
import { MetricsQueryService } from './services/metrics-query.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { UserSegmentationService } from './services/user-segmentation.service';
import { Trade } from '../trading-engine/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { Transaction } from '../transactions/entities/transaction.entity';

describe('Analytics Module Services', () => {
  let module: TestingModule;
  let metricsCollector: MetricsCollectorService;
  let metricsQuery: MetricsQueryService;
  let reportGenerator: ReportGeneratorService;
  let userSegmentation: UserSegmentationService;

  const mockAnalyticsMetricRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
    remove: jest.fn(),
  };

  const mockSavedReportRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
    remove: jest.fn(),
  };

  const mockUserSegmentRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
    remove: jest.fn(),
  };

  const mockTradeRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockUserRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockTransactionRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        MetricsCollectorService,
        MetricsQueryService,
        ReportGeneratorService,
        UserSegmentationService,
        {
          provide: getRepositoryToken(AnalyticsMetric),
          useValue: mockAnalyticsMetricRepo,
        },
        {
          provide: getRepositoryToken(SavedReport),
          useValue: mockSavedReportRepo,
        },
        {
          provide: getRepositoryToken(UserSegment),
          useValue: mockUserSegmentRepo,
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: mockTradeRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: mockTransactionRepo,
        },
      ],
    }).compile();

    await module.init();
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    metricsCollector = module.get<MetricsCollectorService>(MetricsCollectorService);
    metricsQuery = module.get<MetricsQueryService>(MetricsQueryService);
    reportGenerator = module.get<ReportGeneratorService>(ReportGeneratorService);
    userSegmentation = module.get<UserSegmentationService>(UserSegmentationService);
    jest.clearAllMocks();
  });

  const createMockMetric = (overrides?: Partial<AnalyticsMetric>): AnalyticsMetric => ({
    id: 'test-uuid',
    metricType: MetricType.TRADE_VOLUME,
    aggregation: MetricAggregation.DAY,
    timestamp: new Date(),
    value: '1000.00',
    dimensions: undefined,
    assetCode: 'USDC',
    assetIssuer: undefined,
    userId: undefined,
    source: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockReport = (overrides?: Partial<SavedReport>): SavedReport => ({
    id: 'report-uuid',
    userId: 'user-123',
    name: 'Test Report',
    reportType: ReportType.TRADE_SUMMARY,
    format: ReportFormat.JSON,
    status: ReportStatus.PENDING,
    dateFrom: new Date('2024-01-01'),
    dateTo: new Date('2024-01-31'),
    filters: undefined,
    metrics: undefined,
    dimensions: undefined,
    fileUrl: undefined,
    fileSize: undefined,
    completedAt: undefined,
    errorMessage: undefined,
    isScheduled: false,
    scheduleCron: undefined,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockSegment = (overrides?: Partial<UserSegment>): UserSegment => ({
    id: 'segment-uuid',
    name: 'Test Segment',
    description: 'Test segment description',
    segmentType: SegmentType.MANUAL,
    filterCriteria: undefined,
    userIds: ['user-1', 'user-2'],
    userCount: 2,
    lastCalculatedAt: new Date(),
    isActive: true,
    isDeleted: false,
    createdBy: 'admin-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('MetricsCollectorService', () => {
    it('should be defined', () => {
      expect(metricsCollector).toBeDefined();
    });

    it('should record a metric and upsert into all aggregations', async () => {
      mockAnalyticsMetricRepo.findOne.mockResolvedValue(null);
      mockAnalyticsMetricRepo.create.mockReturnValue(createMockMetric());
      mockAnalyticsMetricRepo.save.mockResolvedValue(createMockMetric());

      const result = await metricsCollector.recordMetric(
        MetricType.TRADE_VOLUME,
        '1000.00',
        new Date()
      );

      expect(mockAnalyticsMetricRepo.create).toHaveBeenCalled();
      expect(mockAnalyticsMetricRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should calculate trade metrics correctly', async () => {
      const mockTrades = [
        {
          id: 'trade-1',
          quantity: '100',
          price: '1.00',
          settled: true,
          settledAt: new Date(),
          createdAt: new Date(),
        },
      ];
      mockTradeRepo.find.mockResolvedValue(mockTrades);
      mockAnalyticsMetricRepo.findOne.mockResolvedValue(null);
      mockAnalyticsMetricRepo.create.mockReturnValue(createMockMetric());
      mockAnalyticsMetricRepo.save.mockResolvedValue(createMockMetric());

      const dateFrom = new Date(Date.now() - 86400000);
      const dateTo = new Date();
      
      await metricsCollector.calculateTradeMetrics(dateFrom, dateTo);

      expect(mockTradeRepo.find).toHaveBeenCalled();
      expect(mockAnalyticsMetricRepo.save).toHaveBeenCalledTimes(3);
    });

    it('should calculate user metrics correctly', async () => {
      mockUserRepo.count.mockResolvedValue(50);
      const qb = {
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(100),
      };
      mockUserRepo.createQueryBuilder.mockReturnValue(qb);
      mockAnalyticsMetricRepo.findOne.mockResolvedValue(null);
      mockAnalyticsMetricRepo.create.mockReturnValue(createMockMetric({ metricType: MetricType.USER_NEW }));
      mockAnalyticsMetricRepo.save.mockResolvedValue(createMockMetric({ metricType: MetricType.USER_NEW }));

      const dateFrom = new Date(Date.now() - 86400000);
      const dateTo = new Date();
      
      await metricsCollector.calculateUserMetrics(dateFrom, dateTo);

      expect(mockUserRepo.count).toHaveBeenCalled();
      expect(mockAnalyticsMetricRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should calculate revenue metrics correctly', async () => {
      const mockTransactions = [
        { id: 'tx-1', fee: '5.00', createdAt: new Date() },
        { id: 'tx-2', fee: '3.50', createdAt: new Date() },
      ];
      mockTransactionRepo.find.mockResolvedValue(mockTransactions);
      mockAnalyticsMetricRepo.findOne.mockResolvedValue(null);
      mockAnalyticsMetricRepo.create.mockReturnValue(createMockMetric({ metricType: MetricType.TRANSACTION_FEE }));
      mockAnalyticsMetricRepo.save.mockResolvedValue(createMockMetric({ metricType: MetricType.TRANSACTION_FEE }));

      const dateFrom = new Date(Date.now() - 86400000);
      const dateTo = new Date();
      
      await metricsCollector.calculateRevenueMetrics(dateFrom, dateTo);

      expect(mockTransactionRepo.find).toHaveBeenCalled();
      expect(mockAnalyticsMetricRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('MetricsQueryService', () => {
    it('should be defined', () => {
      expect(metricsQuery).toBeDefined();
    });

    it('should get dashboard summary', async () => {
      const mockMetrics = [createMockMetric()];
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockMetrics),
      };
      mockAnalyticsMetricRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await metricsQuery.getDashboardSummary();
      
      expect(result).toHaveProperty('currentDay');
      expect(result).toHaveProperty('previousDay');
      expect(result).toHaveProperty('changes');
    });

    it('should query metrics with pagination', async () => {
      const queryDto = {
        page: 1,
        limit: 10,
        dateFrom: '2024-01-01T00:00:00Z',
        dateTo: '2024-01-31T23:59:59Z',
      };

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[createMockMetric()], 1]),
      };
      mockAnalyticsMetricRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await metricsQuery.queryMetrics(queryDto as any);
      
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('ReportGeneratorService', () => {
    it('should be defined', () => {
      expect(reportGenerator).toBeDefined();
    });

    it('should create a new report', async () => {
      mockSavedReportRepo.create.mockReturnValue(createMockReport());
      mockSavedReportRepo.save.mockResolvedValue(createMockReport());

      const dto = {
        name: 'Test Report',
        reportType: ReportType.TRADE_SUMMARY,
        format: ReportFormat.JSON,
        dateFrom: '2024-01-01T00:00:00Z',
        dateTo: '2024-01-31T23:59:59Z',
      };

      const result = await reportGenerator.createReport('user-123', dto);
      
      expect(mockSavedReportRepo.create).toHaveBeenCalled();
      expect(mockSavedReportRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('Test Report');
    });

    it('should get user reports', async () => {
      mockSavedReportRepo.find.mockResolvedValue([createMockReport()]);

      const result = await reportGenerator.getUserReports('user-123');
      
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-123');
    });

    it('should get a single report', async () => {
      mockSavedReportRepo.findOne.mockResolvedValue(createMockReport());

      const result = await reportGenerator.getReport('report-uuid');
      
      expect(result).toBeDefined();
      expect(result.id).toBe('report-uuid');
    });
  });

  describe('UserSegmentationService', () => {
    it('should be defined', () => {
      expect(userSegmentation).toBeDefined();
    });

    it('should create a manual segment', async () => {
      mockUserSegmentRepo.create.mockReturnValue(createMockSegment());
      mockUserSegmentRepo.save.mockResolvedValue(createMockSegment());

      const dto = {
        name: 'Test Segment',
        segmentType: SegmentType.MANUAL,
        userIds: ['user-1', 'user-2'],
      };

      const result = await userSegmentation.createSegment('admin-123', dto);
      
      expect(mockUserSegmentRepo.create).toHaveBeenCalled();
      expect(mockUserSegmentRepo.save).toHaveBeenCalled();
      expect(result.userCount).toBe(2);
    });

    it('should get all segments', async () => {
      mockUserSegmentRepo.find.mockResolvedValue([createMockSegment()]);

      const result = await userSegmentation.getAllSegments();
      
      expect(result).toHaveLength(1);
      expect(result[0].isActive).toBe(true);
    });

    it('should add user to manual segment', async () => {
      mockUserSegmentRepo.findOne.mockResolvedValue(createMockSegment());
      mockUserSegmentRepo.save.mockResolvedValue(createMockSegment({ userIds: ['user-1', 'user-2', 'user-3'], userCount: 3 }));

      const result = await userSegmentation.addUserToManualSegment('segment-uuid', 'user-3');
      
      expect(result.userIds).toContain('user-3');
      expect(result.userCount).toBe(3);
    });

    it('should remove user from manual segment', async () => {
      mockUserSegmentRepo.findOne.mockResolvedValue(createMockSegment());
      mockUserSegmentRepo.save.mockResolvedValue(createMockSegment({ userIds: ['user-1'], userCount: 1 }));

      const result = await userSegmentation.removeUserFromManualSegment('segment-uuid', 'user-2');
      
      expect(result.userIds).not.toContain('user-2');
      expect(result.userCount).toBe(1);
    });
  });
});