# InterChangableTrade-Core

> Backend services powering the InterChangableTrade ecosystem on Stellar.

[![Build and TypeScript Check](https://github.com/Chulilee/InterChangableTrade-Core/actions/workflows/build-check.yml/badge.svg)](https://github.com/Chulilee/InterChangableTrade-Core/actions/workflows/build-check.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Status: active development](https://img.shields.io/badge/status-active%20development-brightgreen.svg)
![Network: Stellar testnet](https://img.shields.io/badge/network-Stellar%20testnet-7d00ff.svg)

## Overview

InterChangableTrade-Core provides the application services that connect the
frontend with the **Stellar** blockchain. It exposes REST APIs, manages
business logic, indexes blockchain events, and integrates with **Soroban**
smart contracts — trade execution, asset indexing, settlement, dispute
resolution, and analytics for the InterChangableTrade ecosystem.

The project is in **active development**. All chain access currently targets
the Stellar **testnet** (see [Network & Deployment](#network--deployment)).
See the [Roadmap](ROADMAP.md) for what is coming next and the
[Changelog](CHANGELOG.md) for what has shipped.

## Features

- **REST API** with interactive OpenAPI/Swagger docs
- **Authentication** — JWT plus a Stellar wallet challenge-response flow
  (Ed25519 nonce signing with replay protection)
- **User & wallet management**
- **[Multisig wallets](src/modules/wallet/services/)** — Stellar signer and
  threshold configuration, unsigned transaction construction, signature
  collection, and broadcast through the Stellar service
- **Marketplace & trade execution engine** — asset trade listings and matching
- **Stellar integration** — Horizon API gateway with connection pooling, rate
  limiting, and request queuing
- **Soroban contract layer** — standardized contract invocation
  (build → simulate → sign → submit → poll), ABI validation, gas estimation,
  cached state reads, deployment, and typed error classification
- **Blockchain event indexer** — ledger polling with backfill and Soroban
  contract-event indexing
- **Transaction history**
- **Notifications** — event-driven, templated
- **Dispute resolution & arbitration** — filing, evidence, arbitrator
  assignment, resolution enforcement, appeals, and SLA tracking
- **Analytics & reporting**
- **[Escrow workflows](src/modules/escrow/escrow.service.ts)** — M-of-N
  approvals, milestones, time-locks, and a settlement timeline. The current
  release handler updates database records and records a placeholder settlement
  hash; it does not submit an on-chain funds transfer.
- **[Compliance / KYC / AML](src/modules/compliance/compliance.service.ts)** —
  verification levels, document review, regional configuration, transaction risk
  scoring, and AML flags. Document storage and encryption are currently
  placeholders, not a production encrypted-storage integration.
- **[Webhooks](src/modules/webhooks/)** — subscriptions, signed event delivery,
  delivery history, retries, and secret rotation
- **[Portfolio](src/modules/portfolio/portfolio.service.ts)** — holdings,
  allocation, performance summaries, and historical snapshots. USD valuations
  currently use a fixed testnet XLM estimate and zero for other assets, rather
  than a live price feed.
- **[Liquidity aggregation](src/modules/liquidity-aggregator/README.md)** — pool
  registration, pricing, route planning, split routes, and arbitrage detection.
  Route execution results are mathematical simulations; they are not validated
  on-chain.
- **[Transaction coordination](src/modules/transaction-coordinator/)** — batch
  dependency planning, prepare/commit phases, retries, and audit records. Each
  leg invokes a contract separately; rollback currently changes local status
  without submitting an inverse transaction, so cross-leg on-chain atomicity is
  not guaranteed.
- **[API rate limiting](src/modules/rate-limiting/)** — Redis-backed sliding or
  fixed windows, tier configuration, and endpoint overrides
- **[Audit logging](docs/audit-logging.md)** — request interception, audit queries,
  user exports, retention selection, and report generation
- **Resilience & error recovery** primitives across modules

## Technology Stack

- NestJS
- TypeScript
- PostgreSQL (TypeORM)
- Redis (ioredis)
- Stellar SDK (`@stellar/stellar-sdk`) — Horizon + Soroban RPC

## Project Structure

```
src/
  config/                 Typed configuration, env validation, DB config
  database/               Standalone TypeORM CLI DataSource and migrations
  redis/                  Global Redis (ioredis) provider
  modules/
    analytics/            Analytics & reporting
    assets/               Stellar asset indexing
    audit/                Request audit trail, exports, retention, reports
    auth/                 JWT auth, guards, register/login, Stellar wallet auth
    blockchain-indexer/   Ledger + contract-event indexing
    compliance/           KYC workflows, document review, AML risk assessment
    dispute-resolution/   Disputes, evidence, arbitration, appeals, SLA
    error-handler/        Centralized error handling
    escrow/               Approval thresholds, milestones, time-lock workflows
    liquidity-aggregator/ Pool discovery, pricing, routes, arbitrage simulations
    marketplace/          Asset trade listings
    notifications/        Event-driven, templated notifications
    portfolio/            Holdings, allocation, performance, snapshots
    queue/                Background job queue
    rate-limiting/        Redis request limits, tiers, endpoint overrides
    resilience/           Resilience primitives
    stellar/              Stellar (Horizon) gateway + Soroban integration
    trading/              Trade domain
    trading-engine/       Trade execution
    transaction-coordinator/ Batch planning, execution, retry and rollback state
    transactions/         Transaction history
    users/                User management
    wallet/               Wallet management and Stellar multisig transactions
    webhooks/             Subscriptions, signed deliveries, retry history
  main.ts                 Bootstrap, Swagger, global pipes/filters
libs/
  common/                 Shared entities, DTOs, interceptors, filters (@app/common)
scripts/                  Database init and helper scripts
```

## Getting Started

```bash
git clone https://github.com/Chulilee/InterChangableTrade-Core.git

cd InterChangableTrade-Core

npm ci

# Configure environment (copy and edit)
cp .env.example .env

# Start Postgres + Redis (and optionally the app) via Docker
docker compose up -d postgres redis

npm run start:dev
```

The API is served under the `/api` prefix, with interactive OpenAPI docs at
`http://localhost:3000/api/docs`.

## Scripts

The following commands cover every script in [package.json](package.json).
Install dependencies with `npm ci` before running them.

| Command                                                      | Purpose and prerequisites                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm run prebuild`                                           | Remove `dist/`; npm also runs this automatically before `build`.                                                      |
| `npm run build`                                              | Compile the NestJS application to `dist/`.                                                                            |
| `npm run format`                                             | Format TypeScript in `src/` and `test/` in place.                                                                     |
| `npm start`                                                  | Start the application; requires application configuration, PostgreSQL, and Redis.                                     |
| `npm run start:dev`                                          | Start with file watching; same services as `start`.                                                                   |
| `npm run start:debug`                                        | Start with debugging and file watching; same services as `start`.                                                     |
| `npm run start:prod`                                         | Run the compiled application; requires a successful build and the same services as `start`.                           |
| `npm run lint`                                               | Run ESLint and auto-fix supported issues in place.                                                                    |
| `npm test`                                                   | Run the default Jest suite, including service-dependent integration tests; see the note below.                        |
| `npm run test:watch`                                         | Run the same suite in watch mode; same service requirements as `test`.                                                |
| `npm run test:cov`                                           | Run the same suite with coverage; same service requirements as `test`; output is written to `coverage/`.              |
| `npm run test:e2e`                                           | Run the configured end-to-end suite; see `test/` for each suite's service or mock setup.                              |
| `npm run typeorm -- <command>`                               | Invoke the TypeORM CLI with `src/database/data-source.ts`; database commands need the configured PostgreSQL instance. |
| `npm run migration:create -- src/database/migrations/Name`   | Create an empty migration file; no database connection is required.                                                   |
| `npm run migration:generate -- src/database/migrations/Name` | Compare entities with the configured database and generate a migration; requires PostgreSQL.                          |
| `npm run migration:run`                                      | Apply pending migrations to the configured PostgreSQL database.                                                       |
| `npm run migration:revert`                                   | Revert the latest applied migration; requires PostgreSQL.                                                             |
| `npm run migration:show`                                     | Show applied and pending migrations; requires PostgreSQL.                                                             |

The default Jest suite includes
[`auth.integration.spec.ts`](src/modules/auth/auth.integration.spec.ts), which
boots the full application and requires application configuration, PostgreSQL,
and Redis. These requirements also apply to `test:watch` and `test:cov`; suite
separation is tracked in [#145](https://github.com/Chulilee/InterChangableTrade-Core/issues/145).

After `npm run test:cov`, open `coverage/lcov-report/index.html` to inspect the
HTML report. The script requests coverage but does not set a minimum threshold.
Review [Data Persistence & Database](docs/database.md) and the committed
[migration files](src/database/migrations/) before applying schema changes to an
existing database.

## Docker

```bash
docker compose up --build    # Build and run app + Postgres + Redis
```

## Network & Deployment

The service defaults to the Stellar **testnet**:

| Setting               | Default                               |
| --------------------- | ------------------------------------- |
| `STELLAR_NETWORK`     | `testnet`                             |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `SOROBAN_RPC_URL`     | `https://soroban-testnet.stellar.org` |

Write invocations and contract deployments require a funded source account via
`SOROBAN_SOURCE_SECRET`; without it the Soroban client runs in read-only mode.
**Never commit secrets or mainnet credentials** — see [SECURITY.md](SECURITY.md).

## Documentation

- [Roadmap](ROADMAP.md) — direction and upcoming milestones
- [Changelog](CHANGELOG.md) — released changes
- [Data Persistence & Database](docs/database.md) — pooling, transactions,
  migrations, constraints
- [Audit Logging](docs/audit-logging.md) — compliance and audit trail
- API reference — Swagger UI at `/api/docs` when the app is running

## Related Repositories

- [InterChangableTrade-Fricks](https://github.com/Chulilee/InterChangableTrade-Fricks)
- [InterChangableTrade-Protocol](https://github.com/Chulilee/InterChangableTrade-Protocol)
  — Soroban smart contracts (access-control, escrow, marketplace, etc.)

## Contributing

Community contributions are always welcome. Please read:

- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow and standards
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community expectations
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities privately

Use the issue templates to report bugs or request features, and open pull
requests against `main`.

## License

Licensed under the [Apache License 2.0](LICENSE).
