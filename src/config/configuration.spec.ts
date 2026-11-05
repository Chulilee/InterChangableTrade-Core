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

describe('configuration: cors', () => {
  const keys = ['CORS_ALLOWED_ORIGINS', 'NODE_ENV'];
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

  it('parses the comma-separated allowlist', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS:
        'https://app.example.com, https://admin.example.com ,',
    });

    expect(configuration().cors.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('falls back to localhost origins outside production', () => {
    process.env.NODE_ENV = 'development';

    expect(configuration().cors.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
  });

  it('allows no origins in production when the variable is unset', () => {
    process.env.NODE_ENV = 'production';

    expect(configuration().cors.allowedOrigins).toEqual([]);
  });

  it('keeps credentials enabled with closed lists', () => {
    expect(configuration().cors).toMatchObject({
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Api-Key',
        'X-Request-Id',
      ],
      maxAge: 600,
    });
  });
});
