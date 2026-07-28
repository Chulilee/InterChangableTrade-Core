import { DisputeAnalyticsService } from './dispute-analytics.service';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeClassification } from '../enums/dispute-classification.enum';

describe('DisputeAnalyticsService', () => {
  let service: DisputeAnalyticsService;
  let repo: { find: jest.Mock; count: jest.Mock };

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    service = new DisputeAnalyticsService(repo as never);
  });

  it('calculates dashboard metrics', async () => {
    const now = new Date();
    repo.find.mockResolvedValue([
      {
        id: 'd1',
        status: DisputeStatus.FILED,
        classification: DisputeClassification.FRAUD,
        appealed: false,
        createdAt: now,
        resolvedAt: null,
        resolutionDeadline: new Date(now.getTime() + 14 * 86400000),
      },
      {
        id: 'd2',
        status: DisputeStatus.RESOLVED,
        classification: DisputeClassification.NON_DELIVERY,
        appealed: true,
        createdAt: new Date(now.getTime() - 5 * 86400000),
        resolvedAt: now,
        resolutionDeadline: new Date(now.getTime() + 9 * 86400000),
      },
    ]);

    const metrics = await service.getDashboardMetrics();

    expect(metrics.totalDisputes).toBe(2);
    expect(metrics.openDisputes).toBe(1);
    expect(metrics.resolvedDisputes).toBe(1);
    expect(metrics.appealedDisputes).toBe(1);
    expect(metrics.byClassification).toBeDefined();
    expect(metrics.byStatus).toBeDefined();
    expect(metrics.trends).toHaveLength(6);
  });

  it('returns zero average when no resolved disputes', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'd1',
        status: DisputeStatus.FILED,
        classification: DisputeClassification.FRAUD,
        appealed: false,
        createdAt: new Date(),
      },
    ]);

    const metrics = await service.getDashboardMetrics();

    expect(metrics.averageResolutionDays).toBe(0);
    expect(metrics.slaComplianceRate).toBe(100);
  });
});
