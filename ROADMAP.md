# Roadmap

This roadmap describes the direction of InterChangableTrade-Core. It is a
living document — dates are targets, not commitments, and priorities may shift
based on ecosystem needs and contributor feedback. Progress is tracked through
[GitHub Issues](https://github.com/InterChangableTrade/InterChangableTrade-Core/issues)
and reflected in the [CHANGELOG](CHANGELOG.md).

## Vision

InterChangableTrade-Core is the backbone of the InterChangableTrade ecosystem:
a production-grade backend that lets applications trade, index, and settle
assets on the **Stellar** network through **Soroban** smart contracts, with the
reliability, observability, and safety that real financial workloads require.

## Status — as of August 2026

The `0.1.0` MVP is complete: authentication (including Stellar wallet
challenge-response), the Soroban contract-invocation layer, a Stellar API
gateway, a blockchain event indexer, a trade execution engine and marketplace,
plus wallet, notifications, dispute-resolution, and analytics modules. All
chain access currently targets the Stellar **testnet**.

## Near term — Q3 2026

Focus: **prove it on-chain and harden the platform.**

- [ ] **Verified testnet deployment.** Deploy the reference Soroban
      contract(s) to testnet and publish the contract IDs and example
      transaction hashes in the README, so the integration is independently
      verifiable on a public block explorer.
- [ ] **End-to-end demo flow.** A scripted walkthrough (list → trade →
      settle → index) runnable against testnet, with seed data.
- [ ] **Expanded test coverage.** Grow unit-test coverage and add end-to-end
      tests beyond dispute resolution; publish a coverage report in CI.
- [ ] **CI hardening.** Run lint and the test suite in the pipeline (in
      addition to type-check and build), and add dependency/security scanning.
- [ ] **API documentation.** Complete Swagger/OpenAPI annotations across all
      modules and publish a hosted API reference.

## Mid term — Q4 2026

Focus: **mainnet readiness and integrations.**

- [ ] **Mainnet configuration path** with a documented key-management and
      signer strategy (no secrets in the repo; testnet remains the default).
- [ ] **Observability** — structured logging, metrics, and health/readiness
      endpoints suitable for production deployment.
- [ ] **Rate-limit and resilience tuning** validated under load testing.
- [ ] **Reference frontend integration** with the related
      `InterChangableTrade-Fricks` and `InterChangableTrade-Protocol`
      repositories.
- [ ] **Webhooks / streaming API** for downstream consumers of indexed
      blockchain events.

## Longer term — 2027 and beyond

- [ ] **`1.0.0` stable release** with a documented support and versioning
      policy.
- [ ] **Horizontal scalability** for the indexer and trade engine.
- [ ] **Multi-asset and path-payment** support surfaced through the
      marketplace.
- [ ] **Community-governed** module roadmap.

## How to get involved

We welcome contributions of all sizes. Good places to start:

- Issues labelled [`good first issue`](https://github.com/InterChangableTrade/InterChangableTrade-Core/labels/good%20first%20issue).
- The near-term items above — comment on the tracking issue to claim one.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.
