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
    poolMax: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    poolMin: parseInt(process.env.DB_POOL_MIN ?? '5', 10),
    ssl: process.env.DB_SSL === 'true',
    migrationsDir: process.env.DB_MIGRATIONS_DIR ?? 'src/migrations',
    backupEnabled: process.env.DB_BACKUP_ENABLED === 'true',
    backupIntervalMin: parseInt(process.env.DB_BACKUP_INTERVAL_MIN ?? '60', 10),
    backupRetentionDays: parseInt(process.env.DB_BACKUP_RETENTION_DAYS ?? '7', 10),
    shardingEnabled: process.env.DB_SHARDING_ENABLED === 'true',
    shardCount: parseInt(process.env.DB_SHARD_COUNT ?? '1', 10),
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '3600s',
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
    pollIntervalMs: parseInt(process.env.SOROBAN_POLL_INTERVAL_MS ?? '1000', 10),
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
});
