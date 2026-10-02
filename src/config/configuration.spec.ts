import configuration from './configuration';

describe('configuration: stellar gateway', () => {
  const keys = [
    'STELLAR_POOL_MIN_CONNECTIONS',
    'STELLAR_POOL_MAX_CONNECTIONS',
    'STELLAR_POOL_IDLE_TIMEOUT_MS',
    'STELLAR_POOL_CONNECTION_TTL_MS',
    'STELLAR_RATE_LIMIT_ENABLED',
    'STELLAR_RATE_LIMIT_PER_MINUTE',
    'STELLAR_RATE_BURST_LIMIT',
    'STELLAR_MAX_QUEUE_SIZE',
    'STELLAR_MAX_CONCURRENT_REQUESTS',
    'STELLAR_PROCESSING_INTERVAL_MS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reads the gateway keys the services look up under `stellar`', () => {
    Object.assign(process.env, {
      STELLAR_POOL_MIN_CONNECTIONS: '3',
      STELLAR_POOL_MAX_CONNECTIONS: '20',
      STELLAR_POOL_IDLE_TIMEOUT_MS: '15000',
      STELLAR_POOL_CONNECTION_TTL_MS: '600000',
      STELLAR_RATE_LIMIT_ENABLED: 'false',
      STELLAR_RATE_LIMIT_PER_MINUTE: '120',
      STELLAR_RATE_BURST_LIMIT: '25',
      STELLAR_MAX_QUEUE_SIZE: '500',
      STELLAR_MAX_CONCURRENT_REQUESTS: '8',
      STELLAR_PROCESSING_INTERVAL_MS: '75',
    });

    expect(configuration().stellar).toMatchObject({
      poolMinConnections: 3,
      poolMaxConnections: 20,
      poolIdleTimeoutMs: 15000,
      poolConnectionTtlMs: 600000,
      rateLimitEnabled: false,
      rateLimitPerMinute: 120,
      rateBurstLimit: 25,
      maxQueueSize: 500,
      maxConcurrentRequests: 8,
      processingIntervalMs: 75,
    });
  });

  it('falls back to the same defaults the gateway services use', () => {
    expect(configuration().stellar).toMatchObject({
      poolMinConnections: 2,
      poolMaxConnections: 10,
      poolIdleTimeoutMs: 30000,
      poolConnectionTtlMs: 3600000,
      rateLimitEnabled: true,
      rateLimitPerMinute: 60,
      rateBurstLimit: 10,
      maxQueueSize: 100,
      maxConcurrentRequests: 5,
      processingIntervalMs: 50,
    });
  });
});
