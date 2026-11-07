import {
  MetricsCollectorService,
  computeDimensionHash,
  isUniqueViolation,
} from './metrics-collector.service';
import {
  MetricType,
  MetricAggregation,
} from '../entities/analytics-metric.entity';

describe('MetricsCollectorService unique grain (issue #91)', () => {
  const TS = new Date('2026-01-15T00:00:00.000Z');
  let rows: Map<string, any>;
  let nextId: number;
  let analyticsMetricRepository: any;

  const grainKey = (row: any) =>
    `${row.metricType}|${row.aggregation}|${new Date(
      row.timestamp,
    ).toISOString()}|${row.dimensionHash}`;

  const makeRepository = () => {
    rows = new Map();
    nextId = 0;
    analyticsMetricRepository = {
      findOne: jest.fn(async ({ where }: any) => {
        for (const row of rows.values()) {
          if (
            row.metricType === where.metricType &&
            row.aggregation === where.aggregation &&
            new Date(row.timestamp).getTime() ===
              new Date(where.timestamp).getTime() &&
            row.dimensionHash === where.dimensionHash
          ) {
            return { ...row };
          }
        }
        return null;
      }),
      create: jest.fn((value: any) => {
        nextId += 1;
        return { id: `row-${nextId}`, ...value };
      }),
      save: jest.fn(async (entity: any) => {
        const key = grainKey(entity);
        for (const existing of rows.values()) {
          if (grainKey(existing) === key && existing.id !== entity.id) {
            const error = new Error(
              'duplicate key value violates unique constraint "IDX_analytics_metrics_grain_hash"',
            ) as Error & { code: string };
            error.code = '23505';
            throw error;
          }
        }
        rows.set(entity.id, { ...entity });
        return entity;
      }),
    };
  };

  const makeService = () => {
    makeRepository();
    return new MetricsCollectorService(
      analyticsMetricRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );
  };

  const upsert = (service: MetricsCollectorService, assetCode?: string) =>
    (service as any).upsertMetric(
      MetricType.TRADE_VOLUME,
      MetricAggregation.DAY,
      TS,
      '10',
      undefined,
      assetCode,
      undefined,
      undefined,
      undefined,
    );

  it('computeDimensionHash distinguishes assets and coalesces missing values', () => {
    expect(
      computeDimensionHash({ assetCode: 'USDC' }),
    ).not.toBe(computeDimensionHash({ assetCode: 'XLM' }));
    expect(computeDimensionHash({ assetCode: 'USDC' })).toBe(
      computeDimensionHash({ assetCode: 'USDC' }),
    );
    expect(computeDimensionHash({})).toBe(
      computeDimensionHash({ assetCode: '', userId: '' }),
    );
  });

  it('isUniqueViolation recognizes Postgres 23505', () => {
    const violation = new Error('duplicate key') as Error & { code: string };
    violation.code = '23505';
    expect(isUniqueViolation(violation)).toBe(true);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });

  it('records two assetCodes at the same bucket as two distinct rows', async () => {
    const service = makeService();

    await upsert(service, 'USDC');
    await upsert(service, 'XLM');

    expect(rows.size).toBe(2);
  });

  it('upserts an identical metric instead of throwing', async () => {
    const service = makeService();

    await upsert(service, 'USDC');
    await upsert(service, 'USDC');

    expect(rows.size).toBe(1);
    expect(rows.values().next().value.value).toBe('20');
  });

  it('converges 10 parallel identical upserts to exactly one row', async () => {
    const service = makeService();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => upsert(service, 'USDC')),
    );

    expect(results).toHaveLength(10);
    expect(rows.size).toBe(1);
  });
});
