import {
  AnalyticsMetric,
  MetricAggregation,
  MetricType,
} from '../entities/analytics-metric.entity';
import {
  PoolAnalyticsService,
  findValueAtOffset,
} from './pool-analytics.service';

const HOUR_MS = 60 * 60 * 1000;

function metric(
  value: number,
  timestamp: Date,
  overrides: Partial<AnalyticsMetric> = {},
): AnalyticsMetric {
  return {
    value: value.toFixed(7),
    timestamp,
    metricType: MetricType.POOL_TVL,
    aggregation: MetricAggregation.HOUR,
    dimensionHash: '',
    ...overrides,
  } as AnalyticsMetric;
}

describe('findValueAtOffset', () => {
  const now = new Date('2026-01-02T12:00:00.000Z');
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * HOUR_MS);

  it('returns the value from ~24 hours before the newest sample', () => {
    const metrics = [
      metric(100, hoursAgo(24)),
      metric(150, hoursAgo(0)),
      metric(120, hoursAgo(12)),
    ];

    expect(findValueAtOffset(metrics, 24).value).toBe(100);
  });

  it('selects the newest sample by timestamp, not array position', () => {
    const metrics = [
      metric(150, hoursAgo(0)),
      metric(100, hoursAgo(24)),
      metric(120, hoursAgo(12)),
    ];

    const result = findValueAtOffset(metrics, 24);
    expect(result.value).toBe(100);
    expect(result.outOfRange).toBe(false);
  });

  it('reports an offset older than the available data explicitly', () => {
    const metrics = [metric(140, hoursAgo(2)), metric(150, hoursAgo(0))];

    const result = findValueAtOffset(metrics, 24);

    expect(result.value).toBeNull();
    expect(result.outOfRange).toBe(true);
    expect(result.targetTime).toEqual(hoursAgo(24));
  });

  it('returns no value for a single sample', () => {
    const result = findValueAtOffset([metric(150, hoursAgo(0))], 24);

    expect(result.value).toBeNull();
    expect(result.outOfRange).toBe(true);
  });

  it('returns the value for equal consecutive samples', () => {
    const metrics = [metric(150, hoursAgo(24)), metric(150, hoursAgo(0))];

    expect(findValueAtOffset(metrics, 24).value).toBe(150);
  });

  it('distinguishes a missing sample from a zero value', () => {
    const zero = findValueAtOffset(
      [metric(0, hoursAgo(24)), metric(100, hoursAgo(0))],
      24,
    );
    const missing = findValueAtOffset([metric(100, hoursAgo(0))], 24);

    expect(zero.value).toBe(0);
    expect(missing.value).toBeNull();
  });

  it('returns an empty result for an empty series', () => {
    expect(findValueAtOffset([], 24)).toEqual({
      value: null,
      sample: null,
      targetTime: null,
      outOfRange: false,
    });
  });

  it('rejects a negative offset', () => {
    expect(() => findValueAtOffset([], -1)).toThrow(RangeError);
  });
});

describe('PoolAnalyticsService.getPoolMetrics', () => {
  const now = new Date('2026-01-02T12:00:00.000Z');
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * HOUR_MS);

  let find: jest.Mock;
  let service: PoolAnalyticsService;

  beforeEach(() => {
    find = jest.fn();
    service = new PoolAnalyticsService({ find } as never, {} as never);
  });

  it('reports a positive 24h change when TVL grows from 100 to 150', async () => {
    const tvlMetrics = [
      metric(150, hoursAgo(0), {
        poolId: 'pool-1',
        assetCode: 'USDC',
      }),
      metric(100, hoursAgo(24), { poolId: 'pool-1', assetCode: 'USDC' }),
    ];

    find.mockImplementation(async ({ where }: any) =>
      where.metricType === MetricType.POOL_TVL ? tvlMetrics : [],
    );

    const result = await service.getPoolMetrics(
      'pool-1',
      hoursAgo(168),
      now,
    );

    expect(result.tvl).toBe(150);
    expect(result.tvlChange24h).toBeCloseTo(50);
    // Only 24h of history, so the 7d offset is out of range and not a real 0.
    expect(result.tvlChange7d).toBe(0);
    expect(result.assetCode).toBe('USDC');
  });

  it('reports zero change for equal consecutive values', async () => {
    const tvlMetrics = [
      metric(150, hoursAgo(0), { poolId: 'pool-1' }),
      metric(150, hoursAgo(24), { poolId: 'pool-1' }),
    ];

    find.mockImplementation(async ({ where }: any) =>
      where.metricType === MetricType.POOL_TVL ? tvlMetrics : [],
    );

    const result = await service.getPoolMetrics(
      'pool-1',
      hoursAgo(168),
      now,
    );

    expect(result.tvlChange24h).toBe(0);
  });

  it('does not divide by zero when the prior sample was zero', async () => {
    const tvlMetrics = [
      metric(150, hoursAgo(0), { poolId: 'pool-1' }),
      metric(0, hoursAgo(24), { poolId: 'pool-1' }),
    ];

    find.mockImplementation(async ({ where }: any) =>
      where.metricType === MetricType.POOL_TVL ? tvlMetrics : [],
    );

    const result = await service.getPoolMetrics(
      'pool-1',
      hoursAgo(168),
      now,
    );

    expect(result.tvlChange24h).toBe(0);
  });
});
