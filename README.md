# InterChangableTrade-Core

> Backend services powering the InterChangableTrade ecosystem on Stellar.

[![Build and TypeScript Check](https://github.com/InterChangableTrade/InterChangableTrade-Core/actions/workflows/build-check.yml/badge.svg)](https://github.com/InterChangableTrade/InterChangableTrade-Core/actions/workflows/build-check.yml)
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
  redis/                  Global Redis (ioredis) provider
  modules/
    auth/                 JWT auth, guards, register/login, Stellar wallet auth
    users/                User management
    wallet/               Wallet management
    marketplace/          Asset trade listings
    trading/              Trade domain
    trading-engine/       Trade execution
    assets/               Stellar asset indexing
    transactions/         Transaction history
    stellar/              Stellar (Horizon) gateway + Soroban integration
    blockchain-indexer/   Ledger + contract-event indexing
    notifications/        Event-driven, templated notifications
    dispute-resolution/   Disputes, evidence, arbitration, appeals, SLA
    analytics/            Analytics & reporting
    error-handler/        Centralized error handling
    resilience/           Resilience primitives
    queue/                Background job queue
  main.ts                 Bootstrap, Swagger, global pipes/filters
libs/
  common/                 Shared entities, DTOs, interceptors, filters (@app/common)
scripts/                  Database init and helper scripts
```

## Getting Started

```bash
git clone https://github.com/InterChangableTrade/InterChangableTrade-Core.git

cd InterChangableTrade-Core

npm install

# Configure environment (copy and edit)
cp .env.example .env

# Start Postgres + Redis (and optionally the app) via Docker
docker compose up -d postgres redis

npm run start:dev
```

The API is served under the `/api` prefix, with interactive OpenAPI docs at
`http://localhost:3000/api/docs`.

## Scripts

```bash
npm run start:dev     # Watch-mode development server
npm run build         # Compile to dist/
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run lint          # Lint and auto-fix
```

## Docker

```bash
docker compose up --build    # Build and run app + Postgres + Redis
```

## Network & Deployment

The service defaults to the Stellar **testnet**:

| Setting                      | Default                                 |
| ---------------------------- | --------------------------------------- |
| `STELLAR_NETWORK`            | `testnet`                               |
| `STELLAR_HORIZON_URL`        | `https://horizon-testnet.stellar.org`   |
| `SOROBAN_RPC_URL`            | `https://soroban-testnet.stellar.org`   |

Write invocations and contract deployments require a funded source account via
`SOROBAN_SOURCE_SECRET`; without it the Soroban client runs in read-only mode.
**Never commit secrets or mainnet credentials** — see [SECURITY.md](SECURITY.md).

<!-- On-chain proof: once the reference contract is deployed to testnet,
     publish the contract ID(s) and an example transaction hash here so the
     integration is independently verifiable on a public block explorer.
     Tracked in ROADMAP.md (Near term — Q3 2026). -->

## Documentation

- [Roadmap](ROADMAP.md) — direction and upcoming milestones
- [Changelog](CHANGELOG.md) — released changes
- [Data Persistence & Database](docs/database.md) — pooling, transactions,
  migrations, constraints
- [Audit Logging](docs/audit-logging.md) — compliance and audit trail
- API reference — Swagger UI at `/api/docs` when the app is running

## Related Repositories

- InterChangableTrade-Fricks
- InterChangableTrade-Protocol

## Contributing

Community contributions are always welcome. Please read:

- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow and standards
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community expectations
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities privately

Use the issue templates to report bugs or request features, and open pull
requests against `main`.

## License

Licensed under the [Apache License 2.0](LICENSE).
