import * as Joi from 'joi';

/**
 * Fail fast at boot if the environment is misconfigured. A missing DB
 * password or JWT secret should stop startup, not surface as a runtime error.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('3600s'),

  STELLAR_NETWORK: Joi.string().valid('testnet', 'public').default('testnet'),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  SOROBAN_RPC_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),

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
});
