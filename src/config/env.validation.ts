import * as Joi from 'joi';

/**
 * Fail fast at boot if the environment is misconfigured. A missing DB
 * password or JWT secret should stop startup, not surface as a runtime error.
 *
 * Unknown-key policy: unknown keys are ALLOWED at boot (`allowUnknown: true`
 * in `config.module.ts`). The schema is checked against `.env` merged with the
 * whole `process.env`, which always contains OS variables such as PATH, so a
 * strict check could never pass there. Drift between this schema and
 * `.env.example` is caught instead by `env.validation.spec.ts`, which validates
 * `.env.example` strictly: every key in it must be declared here, and every
 * key declared here must be listed in it.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Comma-separated allowlist of origins that may call the API cross-origin
  // (e.g. `https://app.example.com,https://admin.example.com`). Required in
  // production: the Express/cors default of `origin: *` would let any page on
  // the internet read API responses. Outside production the value is optional
  // and `configuration.ts` falls back to the localhost dev origins.
  CORS_ALLOWED_ORIGINS: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .required()
        .custom((value: string, helpers: Joi.CustomHelpers) => {
          const origins = value
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0);
          if (origins.length === 0 || origins.some((o) => o.includes('*'))) {
            return helpers.error('any.invalid');
          }
          return value;
        }),
      otherwise: Joi.string().allow('').optional(),
    }),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_POOL_MAX: Joi.number().integer().min(1).default(20),
  DB_POOL_MIN: Joi.number().integer().min(0).default(5),
  DB_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
  DB_POOL_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(0).default(5000),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('3600s'),
  JWT_REFRESH_EXPIRES_IN: Joi.number().default(2592000), // 30 days in seconds

  // Pepper for the deterministic credential lookup hashes (HMAC-SHA256 over
  // refresh tokens, password-reset tokens and API keys). Optional: when unset
  // the value of JWT_SECRET is used. Rotating it invalidates every outstanding
  // credential, exactly like rotating JWT_SECRET. See docs/database.md.
  AUTH_TOKEN_PEPPER: Joi.string().min(16).allow('').optional(),
  // Interval for purging expired refresh tokens, reset tokens and Stellar
  // auth challenges (milliseconds). Default: hourly.
  AUTH_CREDENTIAL_CLEANUP_INTERVAL_MS: Joi.number()
    .integer()
    .min(60000)
    .default(3600000),

  // Secret for the AES-256-GCM key that encrypts wallet secret keys at rest.
  // WalletService already refuses to start without it; validate here so the
  // failure is a clear boot-time message rather than a constructor throw.
  WALLET_ENCRYPTION_KEY: Joi.string().min(32).required(),
  // Comma-separated operation types WalletService may sign. Defaults to
  // classic payments only; setOptions/accountMerge still require admin +
  // step-up auth even when listed here.
  WALLET_SIGNING_ALLOWED_OPERATIONS: Joi.string().default('payment'),

  STELLAR_NETWORK: Joi.string().valid('testnet', 'public').default('testnet'),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  SOROBAN_RPC_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),

  // Stellar API gateway (see `stellar` in configuration.ts)
  STELLAR_POOL_MIN_CONNECTIONS: Joi.number().integer().min(0).default(2),
  STELLAR_POOL_MAX_CONNECTIONS: Joi.number().integer().min(1).default(10),
  STELLAR_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),
  STELLAR_POOL_CONNECTION_TTL_MS: Joi.number()
    .integer()
    .min(0)
    .default(3600000),
  STELLAR_RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  STELLAR_RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(60),
  STELLAR_RATE_BURST_LIMIT: Joi.number().integer().min(1).default(10),
  STELLAR_MAX_QUEUE_SIZE: Joi.number().integer().min(1).default(100),
  STELLAR_MAX_CONCURRENT_REQUESTS: Joi.number().integer().min(1).default(5),
  STELLAR_PROCESSING_INTERVAL_MS: Joi.number().integer().min(0).default(50),

  // Soroban smart-contract module. All optional with sensible defaults so the
  // module boots in read-only mode without extra configuration.
  SOROBAN_ALLOW_HTTP: Joi.boolean().default(false),
  SOROBAN_SOURCE_SECRET: Joi.string()
    .pattern(/^S[A-Z2-7]{55}$/)
    .optional(),
  SOROBAN_TX_TIMEOUT_SECS: Joi.number().default(30),
  SOROBAN_POLL_INTERVAL_MS: Joi.number().default(1000),
  SOROBAN_POLL_TIMEOUT_MS: Joi.number().default(30000),
  SOROBAN_STATE_CACHE_TTL_SECS: Joi.number().default(30),
  SOROBAN_EVENT_POLL_INTERVAL_MS: Joi.number().default(500),
  SOROBAN_EVENT_RETENTION_SECS: Joi.number().default(86400),
  SOROBAN_EVENT_PAGE_LIMIT: Joi.number().default(100),

  BLOCKCHAIN_INDEXER_ENABLED: Joi.boolean().default(true),
  BLOCKCHAIN_INDEXER_POLL_INTERVAL_MS: Joi.number().default(2000),
  BLOCKCHAIN_INDEXER_MAX_BACKFILL_LEDGERS: Joi.number().default(1000),
  BLOCKCHAIN_INDEXER_STREAM_TTL_SECS: Joi.number().default(300),
  BLOCKCHAIN_INDEXER_INCLUDE_FAILED: Joi.boolean().default(true),
  BLOCKCHAIN_INDEXER_PAGE_LIMIT: Joi.number().default(200),
  BLOCKCHAIN_INDEXER_WS_RECONNECT_BASE_MS: Joi.number().default(1000),
  BLOCKCHAIN_INDEXER_WS_RECONNECT_MAX_MS: Joi.number().default(30000),
  BLOCKCHAIN_INDEXER_BUFFER_SIZE: Joi.number().default(10000),
  BLOCKCHAIN_INDEXER_BUFFER_TTL_MS: Joi.number().default(60000),
  BLOCKCHAIN_INDEXER_BATCH_FLUSH_MS: Joi.number().default(1000),
  BLOCKCHAIN_INDEXER_BATCH_MAX_SIZE: Joi.number().default(1000),
  BLOCKCHAIN_INDEXER_RETENTION_DAYS: Joi.number().default(90),
  BLOCKCHAIN_INDEXER_REORG_CHECK_INTERVAL_MS: Joi.number().default(300000),

  // Express `trust proxy` hop count (see docs/rate-limiting.md). `0` means the
  // app is not behind a proxy and `X-Forwarded-For` is ignored entirely.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(1),

  // Rate limiting
  RATE_LIMIT_STRATEGY: Joi.string()
    .valid('sliding_window', 'fixed_window')
    .default('sliding_window'),
  RATE_LIMIT_DEFAULT_WINDOW: Joi.number().default(60),

  // Notification services (Twilio SMS)
  TWILIO_ACCOUNT_SID: Joi.string().optional(),
  TWILIO_AUTH_TOKEN: Joi.string().optional(),
  TWILIO_PHONE_NUMBER: Joi.string().optional(),
  NOTIFICATION_EMAIL_FROM: Joi.string().email().optional(),

  // Notification services (chat). Each provider is a no-op when its key is unset.
  TELEGRAM_BOT_TOKEN: Joi.string().optional(),
  DISCORD_WEBHOOK_URL: Joi.string().uri().optional(),
});
