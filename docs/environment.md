# Environment variable reference

This document is the authoritative reference for environment variables consumed by InterChangableTrade-Core. It must stay in sync with `src/config/env.validation.ts` (boot-time Joi schema) and `.env.example`.

- **Source of truth for validation/defaults:** `src/config/env.validation.ts`
- **Typed config mapping:** `src/config/configuration.ts`
- **Template:** `.env.example`
- **Drift check:** `scripts/check-env-docs.js` verifies every schema variable is documented here and that `.env.example`/schema stay aligned (see also `src/config/env.validation.spec.ts`).

> **Security:** Treat all values marked **Secret: Yes** as sensitive. Do not commit real secrets. Use long random values in non-local environments and rotate on compromise.

## Variables

| Variable | Type | Required | Default | Secret | Consumed by (file:line) | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | string (`development` \| `test` \| `production`) | No | `development` | No | `src/config/env.validation.ts:13`, `src/config/configuration.ts:33`, `src/config/configuration.ts:37` | Runtime environment; controls defaults and production-only guards (e.g. CORS). |
| `PORT` | number | No | `3000` | No | `src/config/env.validation.ts:16`, `src/config/configuration.ts:34`, `src/main.ts` | HTTP server port. |
| `CORS_ALLOWED_ORIGINS` | string (comma-separated origins) | In production | empty (dev falls back to localhost origins) | No | `src/config/env.validation.ts:24`, `src/config/configuration.ts:21`, `src/config/configuration.ts:41`, `src/main.ts` | Explicit CORS allowlist. Required and wildcard-free in production. |
| `DB_HOST` | string | No | `localhost` | No | `src/config/env.validation.ts:43`, `src/config/configuration.ts:61`, `src/config/database.config.ts` | PostgreSQL host. |
| `DB_PORT` | number | No | `5432` | No | `src/config/env.validation.ts:44`, `src/config/configuration.ts:62`, `src/config/database.config.ts` | PostgreSQL port. |
| `DB_USERNAME` | string | Yes | — | No | `src/config/env.validation.ts:45`, `src/config/configuration.ts:63`, `src/config/database.config.ts` | PostgreSQL username. |
| `DB_PASSWORD` | string (may be empty) | Yes | — | Yes | `src/config/env.validation.ts:46`, `src/config/configuration.ts:64`, `src/config/database.config.ts` | PostgreSQL password. |
| `DB_NAME` | string | Yes | — | No | `src/config/env.validation.ts:47`, `src/config/configuration.ts:65`, `src/config/database.config.ts` | PostgreSQL database name. |
| `DB_SYNCHRONIZE` | boolean | No | `false` | No | `src/config/env.validation.ts:48`, `src/config/configuration.ts:66`, `src/config/database.config.ts` | TypeORM schema sync. Must be `false` outside local development; use migrations (`npm run migration:run`). |
| `DB_LOGGING` | boolean | No | `false` | No | `src/config/env.validation.ts:49`, `src/config/configuration.ts:67`, `src/config/database.config.ts` | Enables TypeORM query logging. |
| `DB_POOL_MAX` | integer (>=1) | No | `20` | No | `src/config/env.validation.ts:50`, `src/config/configuration.ts:75`, `src/config/database.config.ts` | Max PostgreSQL pool connections. |
| `DB_POOL_MIN` | integer (>=0) | No | `5` | No | `src/config/env.validation.ts:51`, `src/config/configuration.ts:76`, `src/config/database.config.ts` | Min PostgreSQL pool connections. |
| `DB_POOL_IDLE_TIMEOUT_MS` | integer (>=0) | No | `30000` | No | `src/config/env.validation.ts:52`, `src/config/configuration.ts:77`, `src/config/database.config.ts` | Pool idle timeout (ms). |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | integer (>=0) | No | `5000` | No | `src/config/env.validation.ts:53`, `src/config/configuration.ts:81`, `src/config/database.config.ts` | Pool connection timeout (ms). |
| `REDIS_HOST` | string | No | `localhost` | No | `src/config/env.validation.ts:55`, `src/config/configuration.ts:88` | Redis host. |
| `REDIS_PORT` | number | No | `6379` | No | `src/config/env.validation.ts:56`, `src/config/configuration.ts:89` | Redis port. |
| `REDIS_PASSWORD` | string | No | empty | Yes | `src/config/env.validation.ts:57`, `src/config/configuration.ts:90` | Redis password (optional). |
| `JWT_SECRET` | string (min 16) | Yes | — | Yes | `src/config/env.validation.ts:59`, `src/config/configuration.ts:94`, `src/modules/auth/*` | JWT signing secret. |
| `JWT_EXPIRES_IN` | string | No | `3600s` | No | `src/config/env.validation.ts:60`, `src/config/configuration.ts:95`, `src/modules/auth/*` | Access token lifetime. |
| `JWT_REFRESH_EXPIRES_IN` | number | No | `2592000` | No | `src/config/env.validation.ts:61`, `src/config/configuration.ts:96`, `src/modules/auth/*` | Refresh token lifetime (seconds). |
| `AUTH_TOKEN_PEPPER` | string (min 16) | No | empty (falls back to `JWT_SECRET`) | Yes | `src/config/env.validation.ts:68`, `src/config/configuration.ts:111`, `src/modules/auth/*` | HMAC pepper for credential lookup hashes (refresh/reset/API keys). Rotating invalidates outstanding credentials. |
| `AUTH_CREDENTIAL_CLEANUP_INTERVAL_MS` | integer (>=60000) | No | `3600000` | No | `src/config/env.validation.ts:72`, `src/config/configuration.ts:113`, `src/modules/auth/*` | Interval for purging expired credentials/challenges (ms). |
| `WALLET_ENCRYPTION_KEY` | string (min 32) | Yes | — | Yes | `src/config/env.validation.ts:79`, `src/modules/wallet/wallet.service.ts:77`, `src/modules/wallet/wallet.service.ts:81` | Secret used to derive AES-256-GCM key for wallet secret keys at rest. |
| `WALLET_SIGNING_ALLOWED_OPERATIONS` | string (comma-separated) | No | `payment` | No | `src/config/env.validation.ts:83`, `src/config/configuration.ts:129`, `src/modules/wallet/wallet.service.ts` | Custodial signing allowlist; `setOptions`/`accountMerge` still require admin + step-up token. |
| `STELLAR_NETWORK` | string (`testnet` \| `public`) | No | `testnet` | No | `src/config/env.validation.ts:85`, `src/config/configuration.ts:140`, `src/modules/stellar/*` | Stellar network selector. |
| `STELLAR_HORIZON_URL` | URI string | Yes | — | No | `src/config/env.validation.ts:86`, `src/config/configuration.ts:141`, `src/modules/stellar/*` | Horizon endpoint URL. |
| `SOROBAN_RPC_URL` | URI string | Yes | — | No | `src/config/env.validation.ts:87`, `src/config/configuration.ts:142`, `src/modules/stellar/soroban/*` | Soroban RPC endpoint URL. |
| `STELLAR_NETWORK_PASSPHRASE` | string | Yes | — | No | `src/config/env.validation.ts:88`, `src/config/configuration.ts:143`, `src/modules/stellar/*`, `src/modules/wallet/wallet.service.ts` | Stellar network passphrase used for tx building/signing. |
| `STELLAR_POOL_MIN_CONNECTIONS` | integer (>=0) | No | `2` | No | `src/config/env.validation.ts:91`, `src/config/configuration.ts:147`, `src/modules/stellar/gateway/stellar-connection-pool.service.ts:35` | Min Horizon connections in Stellar gateway pool. |
| `STELLAR_POOL_MAX_CONNECTIONS` | integer (>=1) | No | `10` | No | `src/config/env.validation.ts:92`, `src/config/configuration.ts:151`, `src/modules/stellar/gateway/stellar-connection-pool.service.ts:37` | Max Horizon connections in Stellar gateway pool. |
| `STELLAR_POOL_IDLE_TIMEOUT_MS` | integer (>=0) | No | `30000` | No | `src/config/env.validation.ts:93`, `src/config/configuration.ts:155`, `src/modules/stellar/gateway/stellar-connection-pool.service.ts:39` | Idle timeout for pooled Horizon connections (ms). |
| `STELLAR_POOL_CONNECTION_TTL_MS` | integer (>=0) | No | `3600000` | No | `src/config/env.validation.ts:94`, `src/config/configuration.ts:159`, `src/modules/stellar/gateway/stellar-connection-pool.service.ts:41` | Max lifetime for pooled Horizon connections (ms). |
| `STELLAR_RATE_LIMIT_ENABLED` | boolean | No | `true` | No | `src/config/env.validation.ts:98`, `src/config/configuration.ts:164`, `src/modules/stellar/gateway/stellar-rate-limiter.service.ts:37` | Enables Stellar gateway client rate limiting. |
| `STELLAR_RATE_LIMIT_PER_MINUTE` | integer (>=1) | No | `60` | No | `src/config/env.validation.ts:99`, `src/config/configuration.ts:165`, `src/modules/stellar/gateway/stellar-rate-limiter.service.ts:33` | Per-client Stellar gateway request limit per minute. |
| `STELLAR_RATE_BURST_LIMIT` | integer (>=1) | No | `10` | No | `src/config/env.validation.ts:100`, `src/config/configuration.ts:169`, `src/modules/stellar/gateway/stellar-rate-limiter.service.ts:35` | Concurrent/burst limit for Stellar gateway requests. |
| `STELLAR_MAX_QUEUE_SIZE` | integer (>=1) | No | `100` | No | `src/config/env.validation.ts:101`, `src/config/configuration.ts:171`, `src/modules/stellar/gateway/stellar-request-queue.service.ts:33` | Max queued Stellar gateway requests. |
| `STELLAR_MAX_CONCURRENT_REQUESTS` | integer (>=1) | No | `5` | No | `src/config/env.validation.ts:102`, `src/config/configuration.ts:172`, `src/modules/stellar/gateway/stellar-request-queue.service.ts:35` | Max concurrent Stellar gateway requests. |
| `STELLAR_PROCESSING_INTERVAL_MS` | integer (>=0) | No | `50` | No | `src/config/env.validation.ts:103`, `src/config/configuration.ts:176`, `src/modules/stellar/gateway/stellar-request-queue.service.ts:37` | Queue processing interval (ms). |
| `SOROBAN_ALLOW_HTTP` | boolean | No | `false` | No | `src/config/env.validation.ts:108`, `src/config/configuration.ts:183`, `src/modules/stellar/soroban/*` | Allow plain-http Soroban RPC endpoints (local/standalone only). |
| `SOROBAN_SOURCE_SECRET` | string (`S...` seed, 56 chars) | No | unset | Yes | `src/config/env.validation.ts:109`, `src/config/configuration.ts:186`, `src/modules/stellar/soroban/*` | Optional server-side signer for Soroban writes/deploys; module is read-only without it. |
| `SOROBAN_TX_TIMEOUT_SECS` | number | No | `30` | No | `src/config/env.validation.ts:112`, `src/config/configuration.ts:188`, `src/modules/stellar/soroban/*` | Soroban tx validity timeout (seconds). |
| `SOROBAN_POLL_INTERVAL_MS` | number | No | `1000` | No | `src/config/env.validation.ts:113`, `src/config/configuration.ts:192`, `src/modules/stellar/soroban/*` | Poll interval for tx settlement (ms). |
| `SOROBAN_POLL_TIMEOUT_MS` | number | No | `30000` | No | `src/config/env.validation.ts:114`, `src/config/configuration.ts:196`, `src/modules/stellar/soroban/*` | Poll timeout for tx settlement (ms). |
| `SOROBAN_STATE_CACHE_TTL_SECS` | number | No | `30` | No | `src/config/env.validation.ts:115`, `src/config/configuration.ts:198`, `src/modules/stellar/soroban/*` | Contract state cache TTL in Redis (seconds). |
| `SOROBAN_EVENT_POLL_INTERVAL_MS` | number | No | `500` | No | `src/config/env.validation.ts:116`, `src/config/configuration.ts:204`, `src/modules/stellar/soroban/*` | Event indexer poll cadence (ms). |
| `SOROBAN_EVENT_RETENTION_SECS` | number | No | `86400` | No | `src/config/env.validation.ts:117`, `src/config/configuration.ts:209`, `src/modules/stellar/soroban/*` | Indexed event retention in Redis (seconds). |
| `SOROBAN_EVENT_PAGE_LIMIT` | number | No | `100` | No | `src/config/env.validation.ts:118`, `src/config/configuration.ts:213`, `src/modules/stellar/soroban/*` | Max events pulled per poll cycle. |
| `BLOCKCHAIN_INDEXER_ENABLED` | boolean | No | `true` | No | `src/config/env.validation.ts:120`, `src/config/configuration.ts:217`, `src/modules/stellar/blockchain-indexer/*` | Enables blockchain event indexer. |
| `BLOCKCHAIN_INDEXER_POLL_INTERVAL_MS` | number | No | `2000` | No | `src/config/env.validation.ts:121`, `src/config/configuration.ts:218`, `src/modules/stellar/blockchain-indexer/*` | Indexer poll interval (ms). |
| `BLOCKCHAIN_INDEXER_MAX_BACKFILL_LEDGERS` | number | No | `1000` | No | `src/config/env.validation.ts:122`, `src/config/configuration.ts:222`, `src/modules/stellar/blockchain-indexer/*` | Max ledgers to backfill. |
| `BLOCKCHAIN_INDEXER_STREAM_TTL_SECS` | number | No | `300` | No | `src/config/env.validation.ts:123`, `src/config/configuration.ts:227`, `src/modules/stellar/blockchain-indexer/*` | Stream cursor/TTL (seconds). |
| `BLOCKCHAIN_INDEXER_INCLUDE_FAILED` | boolean | No | `true` | No | `src/config/env.validation.ts:124`, `src/config/configuration.ts:226`, `src/modules/stellar/blockchain-indexer/*` | Include failed transactions/events. |
| `BLOCKCHAIN_INDEXER_PAGE_LIMIT` | number | No | `200` | No | `src/config/env.validation.ts:125`, `src/config/configuration.ts:227`, `src/modules/stellar/blockchain-indexer/*` | Page size for indexer fetches. |
| `BLOCKCHAIN_INDEXER_WS_RECONNECT_BASE_MS` | number | No | `1000` | No | `src/config/env.validation.ts:126`, `src/config/configuration.ts:232`, `src/modules/stellar/blockchain-indexer/*` | WS reconnect base delay (ms). |
| `BLOCKCHAIN_INDEXER_WS_RECONNECT_MAX_MS` | number | No | `30000` | No | `src/config/env.validation.ts:127`, `src/config/configuration.ts:236`, `src/modules/stellar/blockchain-indexer/*` | WS reconnect max delay (ms). |
| `BLOCKCHAIN_INDEXER_BUFFER_SIZE` | number | No | `10000` | No | `src/config/env.validation.ts:128`, `src/config/configuration.ts:241`, `src/modules/stellar/blockchain-indexer/*` | In-memory event buffer size. |
| `BLOCKCHAIN_INDEXER_BUFFER_TTL_MS` | number | No | `60000` | No | `src/config/env.validation.ts:129`, `src/config/configuration.ts:245`, `src/modules/stellar/blockchain-indexer/*` | In-memory event buffer TTL (ms). |
| `BLOCKCHAIN_INDEXER_BATCH_FLUSH_MS` | number | No | `1000` | No | `src/config/env.validation.ts:130`, `src/config/configuration.ts:250`, `src/modules/stellar/blockchain-indexer/*` | Batched persistence flush interval (ms). |
| `BLOCKCHAIN_INDEXER_BATCH_MAX_SIZE` | number | No | `1000` | No | `src/config/env.validation.ts:131`, `src/config/configuration.ts:254`, `src/modules/stellar/blockchain-indexer/*` | Max batch size for persistence. |
| `BLOCKCHAIN_INDEXER_RETENTION_DAYS` | number | No | `90` | No | `src/config/env.validation.ts:132`, `src/config/configuration.ts:259`, `src/modules/stellar/blockchain-indexer/*` | Retention period for indexed data (days). |
| `BLOCKCHAIN_INDEXER_REORG_CHECK_INTERVAL_MS` | number | No | `300000` | No | `src/config/env.validation.ts:133`, `src/config/configuration.ts:263`, `src/modules/stellar/blockchain-indexer/*` | Reorg detection cadence (ms). |
| `TRUST_PROXY_HOPS` | integer (0-10) | No | `1` | No | `src/config/env.validation.ts:138`, `src/config/configuration.ts:277`, `src/main.ts` | Express `trust proxy` hop count for resolving client IP behind proxies. |
| `RATE_LIMIT_STRATEGY` | string (`sliding_window` \| `fixed_window`) | No | `sliding_window` | No | `src/config/env.validation.ts:142`, `src/config/configuration.ts:281`, `src/modules/rate-limiting/*` | API rate limiting strategy. |
| `RATE_LIMIT_DEFAULT_WINDOW` | number | No | `60` | No | `src/config/env.validation.ts:145`, `src/config/configuration.ts:282`, `src/modules/rate-limiting/*` | Default API rate limit window (seconds). |
| `TWILIO_ACCOUNT_SID` | string | No | unset | Yes | `src/config/env.validation.ts:148`, `src/config/configuration.ts:291`, `src/modules/notifications/*` | Twilio account SID for SMS notifications. |
| `TWILIO_AUTH_TOKEN` | string | No | unset | Yes | `src/config/env.validation.ts:149`, `src/config/configuration.ts:292`, `src/modules/notifications/*` | Twilio auth token for SMS notifications. |
| `TWILIO_PHONE_NUMBER` | string | No | unset | No | `src/config/env.validation.ts:150`, `src/config/configuration.ts:293`, `src/modules/notifications/*` | Twilio sender phone number. |
| `NOTIFICATION_EMAIL_FROM` | string (email) | No | unset in schema / `noreply@interchangeabletrade.com` in config fallback | No | `src/config/env.validation.ts:151`, `src/config/configuration.ts:289`, `src/modules/notifications/*` | Default sender email for notifications. |
| `TELEGRAM_BOT_TOKEN` | string | No | unset | Yes | `src/config/env.validation.ts:154`, `src/modules/notifications/*` | Telegram bot token (provider no-op when unset). |
| `DISCORD_WEBHOOK_URL` | URI string | No | unset | Yes | `src/config/env.validation.ts:155`, `src/modules/notifications/*` | Discord webhook URL (provider no-op when unset). |

## Notes

- `.env.example` must list every variable declared in `src/config/env.validation.ts` (including optional ones, commented out when unset) and must not include undeclared variables.
- `DB_SYNCHRONIZE` defaults to `false` in validation and must remain `false` in `.env.example` for anything beyond local development; use migrations for schema changes.
- Stellar gateway tuning variables (`STELLAR_POOL_*`, `STELLAR_RATE_*`, `STELLAR_MAX_*`) are wired into `src/config/configuration.ts` and consumed by services in `src/modules/stellar/gateway/`.
- The four Stellar gateway specs (`src/modules/stellar/gateway/*.spec.ts`) mock `ConfigService.get` with keys that exist in `configuration.ts` (e.g. `stellar.poolMinConnections`, `stellar.maxQueueSize`).
