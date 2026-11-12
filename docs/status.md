# Implementation Status

This document summarizes known **stubbed**, **partially implemented**, or **not implemented** behaviors in `InterChangableTrade-Core` so contributors and integrators can distinguish shipped capabilities from placeholders. It complements module-level docs and should be updated when behavior changes.

> Convention used in code/docs where helpful: `Not implemented`, `Stub — ...`, `Partially implemented`, `Shipped`.

## Known gaps and stubs

| Area | Status | Notes |
| --- | --- | --- |
| Analytics scheduled background tasks | Not implemented | `src/modules/analytics/README.md` previously claimed automatic scheduled jobs. No scheduler is registered in `src/` (no `@Cron` / `ScheduleModule` / `@Interval`) for minute/hourly trade/user/revenue calculations, auto-segment recalculation, or old-data cleanup. Invoke available service/controller operations explicitly where supported. |
| Analytics CSV report export | Partially implemented | `report-generator.service.ts` writes JSON content even when CSV is requested (no CSV serializer dependency/integration). JSON export is supported. |
| Dispute resolution enforcement | Stub — records remediation intent only | `dispute-enforcement.service.ts` (`executeEnforcement`) creates local remediation transaction records (e.g. `PENDING`, `fromAccount: 'dispute-resolution'`) but does not submit or guarantee on-chain funds movement. |
| Escrow release/settlement execution | Partially implemented / placeholder settlement hash | Escrow workflows track approvals, milestones, and state transitions in the database, but release paths record placeholder settlement identifiers and do not submit an on-chain funds transfer in the current implementation (see `escrow.service.ts` release/time-lock flows and `README.md` feature notes). |
| Soroban contract state migration (`importContractState`) | Not implemented (generic) | `contract-state.service.ts` throws for non-empty state imports because generic on-chain state migration is unsupported; empty imports are a no-op. Migrate via contract-specific methods where available. |
| Compliance document encryption / KMS integration | Stub — placeholder reference only | `compliance.service.ts` and `kyc-document.entity.ts` record a generated key-reference identifier; document bytes are not encrypted via an integrated KMS in this path. |
| Trading engine expired-order cleanup scheduling | Not implemented (automatic scheduling) | `cleanupExpiredOrders()` exists but there is no registered cron/scheduler invoking it automatically in `src/`. Run/trigger explicitly if needed until a scheduler is added. |
| Portfolio USD valuations | Partially implemented | `README.md`: valuations currently use a fixed testnet XLM estimate and zero for other assets (no live price feed). |
| Liquidity aggregator route execution | Simulated | Route execution/results are mathematical simulations and are not validated on-chain. |
| Transaction coordinator cross-leg atomicity | Partially implemented | Legs invoke contracts separately; rollback updates local status without submitting inverse on-chain transactions, so cross-leg on-chain atomicity is not guaranteed. |

## How to use this document

- Treat endpoint/module presence as insufficient proof of end-to-end on-chain or production behavior; verify against implementation and tests.
- When fixing a gap, update this file and any affected module/README docs in the same change.
- If you discover another stub or misleading status claim, add it here with file references and an accurate status label.