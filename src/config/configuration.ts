/**
 * Central typed configuration factory. Grouping related settings keeps
 * injection points tidy (e.g. `configService.get('database')`).
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',

    // Connection pooling.
    poolMax: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    poolMin: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
    poolIdleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),

    // Run versioned migrations automatically on startup (non-production).
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '3600s',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '2592000', // 30 days in seconds
  },

  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  },

  soroban: {
    // Allow plain-http RPC endpoints (local/standalone networks only).
    allowHttp: process.env.SOROBAN_ALLOW_HTTP === 'true',
    // Optional server-side signer for write invocations and deployments.
    // When absent, the module operates in read-only/simulation mode.
    sourceSecret: process.env.SOROBAN_SOURCE_SECRET,
    // Ledgers a submitted transaction stays valid for before timing out.
    transactionTimeoutSecs: parseInt(
      process.env.SOROBAN_TX_TIMEOUT_SECS ?? '30',
      10,
    ),
    // How long, and how often, we poll RPC for a submitted tx to settle.
    pollIntervalMs: parseInt(
      process.env.SOROBAN_POLL_INTERVAL_MS ?? '1000',
      10,
    ),
    pollTimeoutMs: parseInt(process.env.SOROBAN_POLL_TIMEOUT_MS ?? '30000', 10),
    // Contract state cache TTL (seconds) in Redis.
    stateCacheTtlSecs: parseInt(
      process.env.SOROBAN_STATE_CACHE_TTL_SECS ?? '30',
      10,
    ),
    // Event indexer polling cadence. Kept sub-second to satisfy the
    // "events indexed within 1 second" requirement.
    eventPollIntervalMs: parseInt(
      process.env.SOROBAN_EVENT_POLL_INTERVAL_MS ?? '500',
      10,
    ),
    // How long indexed events are retained in Redis (seconds).
    eventRetentionSecs: parseInt(
      process.env.SOROBAN_EVENT_RETENTION_SECS ?? '86400',
      10,
    ),
    // Cap on events pulled per poll cycle.
    eventPageLimit: parseInt(process.env.SOROBAN_EVENT_PAGE_LIMIT ?? '100', 10),
  },

  blockchainIndexer: {
    enabled: process.env.BLOCKCHAIN_INDEXER_ENABLED === 'true',
    pollIntervalMs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_POLL_INTERVAL_MS ?? '2000',
      10,
    ),
    maxBackfillLedgers: parseInt(
      process.env.BLOCKCHAIN_INDEXER_MAX_BACKFILL_LEDGERS ?? '1000',
      10,
    ),
    includeFailed: process.env.BLOCKCHAIN_INDEXER_INCLUDE_FAILED === 'true',
    pageLimit: parseInt(process.env.BLOCKCHAIN_INDEXER_PAGE_LIMIT ?? '200', 10),
    streamTtlSecs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_STREAM_TTL_SECS ?? '300',
      10,
    ),
    // Real-time WebSocket streaming settings
    wsReconnectBaseDelayMs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_WS_RECONNECT_BASE_MS ?? '1000',
      10,
    ),
    wsReconnectMaxDelayMs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_WS_RECONNECT_MAX_MS ?? '30000',
      10,
    ),
    // In-memory event buffer
    eventBufferSize: parseInt(
      process.env.BLOCKCHAIN_INDEXER_BUFFER_SIZE ?? '10000',
      10,
    ),
    eventBufferTtlMs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_BUFFER_TTL_MS ?? '60000',
      10,
    ),
    // Batched persistence
    batchFlushIntervalMs: parseInt(
      process.env.BLOCKCHAIN_INDEXER_BATCH_FLUSH_MS ?? '1000',
      10,
    ),
    batchMaxSize: parseInt(
      process.env.BLOCKCHAIN_INDEXER_BATCH_MAX_SIZE ?? '1000',
      10,
    ),
    // Retention policy
    retentionDays: parseInt(
      process.env.BLOCKCHAIN_INDEXER_RETENTION_DAYS ?? '90',
      10,
    ),
  },

  rateLimit: {
    strategy: process.env.RATE_LIMIT_STRATEGY ?? 'sliding_window',
    defaultWindowSize: parseInt(process.env.RATE_LIMIT_DEFAULT_WINDOW ?? '60', 10),
  },

  notifications: {
    emailFrom: process.env.NOTIFICATION_EMAIL_FROM ?? 'noreply@interchangeabletrade.com',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    },
  },
});
