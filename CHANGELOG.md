# Changelog

All notable changes to InterChangableTrade-Core are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

See the [ROADMAP](ROADMAP.md) for what is coming next. The immediate focus is
publishing a verified on-chain deployment (contract IDs + example transaction
hashes) and expanding end-to-end test coverage across modules.

## [0.1.0] — 2026-07-28

The initial MVP of the InterChangableTrade backend: a NestJS service that
connects the InterChangableTrade ecosystem to the Stellar network and Soroban
smart contracts. This release established the core platform and its feature
modules.

### Added

- **Project scaffold** — NestJS + TypeScript core, typed configuration with
  environment validation (Joi), PostgreSQL (TypeORM) and Redis (ioredis)
  integration, Docker/Docker Compose setup, Swagger/OpenAPI docs, and a
  `@app/common` shared library.
- **Authentication & authorization** — JWT auth with register/login, guards,
  and a Stellar wallet challenge-response flow (Ed25519 nonce signing with
  replay protection).
- **Stellar integration** — a Stellar API gateway with connection pooling,
  rate limiting, and request queuing over Horizon.
- **Soroban contract layer** — a centralized Soroban RPC client and a
  standardized contract-invocation interface (build → simulate → sign →
  submit → poll), with ABI validation, gas/resource-fee estimation, contract
  state reads with caching, contract deployment, and typed error
  classification.
- **Blockchain event indexer** — a ledger-polling indexer with backfill and a
  Soroban contract-event indexer.
- **Trade execution engine** and **marketplace** — asset trade listings and
  trade execution.
- **Wallet management** module.
- **Asset management** module (Stellar asset indexing).
- **Transaction history** module.
- **Notifications** module (event-driven, templated).
- **Error handling & recovery** and **resilience** modules.
- **Dispute resolution & arbitration** — dispute filing, evidence upload,
  arbitrator assignment, resolution enforcement, appeals, and SLA tracking.
- **Analytics & reporting** module.
- **Continuous integration** — GitHub Actions pipeline running a TypeScript
  type-check and build on every push and pull request.
- **Unit tests** — Jest unit tests across core modules, plus an end-to-end
  test suite for dispute resolution.

[Unreleased]: https://github.com/InterChangableTrade/InterChangableTrade-Core/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/InterChangableTrade/InterChangableTrade-Core/releases/tag/v0.1.0
