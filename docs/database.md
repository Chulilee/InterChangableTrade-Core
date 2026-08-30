# Data Persistence & Database Module

Reference for how this service persists data: connection pooling, transaction
support, migrations, indexing/constraints, and the audit trail. Tracks
[#12](https://github.com/Chulilee/InterChangableTrade-Core/issues/12).

## Stack

PostgreSQL, accessed through TypeORM (`@nestjs/typeorm`), configured in
`src/config/database.config.ts` from validated env vars
(`src/config/configuration.ts`, `src/config/env.validation.ts`).

## Schema & entities

Every persisted table is a TypeORM entity under `src/modules/*/entities/` (45
entities across the modules listed in the top-level README's "Project
Structure" section) plus the shared base columns in
`libs/common/src/entities/base.entity.ts` (`id` UUID PK,
`createdAt`/`updatedAt` timestamptz). There is no separate ER diagram to keep
in sync — the entities *are* the schema, and TypeORM's `autoLoadEntities`
picks up every module's entities automatically.

Most entities already declare `@Index` on their filter/sort columns; see any
file under `src/modules/*/entities/*.entity.ts` for the pattern, and
`src/modules/audit/entities/audit-log.entity.ts` for a heavily-indexed
example (composite indexes on `(userId, createdAt)`, `(action, createdAt)`,
`(resourceType, createdAt)`, plus single-column indexes for point lookups).

## Connection pooling

`DatabaseConfig.createTypeOrmOptions()` forwards pool sizing to the
underlying `pg.Pool` via TypeORM's `extra` option:

| Env var                         | Default | Meaning                                             |
| -------------------------------- | ------- | ---------------------------------------------------- |
| `DB_POOL_MAX`                    | `20`    | Max concurrent connections held open                 |
| `DB_POOL_MIN`                    | `5`     | Connections kept warm even when idle                 |
| `DB_POOL_IDLE_TIMEOUT_MS`        | `30000` | How long an idle connection stays open before closing |
| `DB_POOL_CONNECTION_TIMEOUT_MS`  | `5000`  | How long to wait for a connection before failing      |

Tune `DB_POOL_MAX` against Postgres' own `max_connections` and however many
app instances run concurrently — the sum of every instance's `DB_POOL_MAX`
must stay under Postgres' ceiling (with headroom for migrations, admin
tooling, and read replicas' replication connections).

We have not run a load test in this environment to produce a before/after
latency number for pooled vs. unpooled connections (that requires a live
Postgres instance and a load-generation harness this sandbox doesn't have);
`test/` has no such benchmark today. Establishing a baseline and a
regression-tested performance budget is a good follow-up once the app is
deployed somewhere that can carry the load test.

## Transaction support

`@app/common` exports `@Transactional()` (a method decorator for controller
handlers) backed by `TransactionInterceptor`
(`libs/common/src/interceptors/transaction.interceptor.ts`):

```ts
import { Transactional, TransactionManager } from '@app/common';
import { EntityManager } from 'typeorm';

@Transactional()
@Post()
async create(
  @TransactionManager() manager: EntityManager,
  @Body() dto: CreateWidgetDto,
) {
  const widget = await manager.getRepository(Widget).save(dto);
  await manager.getRepository(WidgetHistory).save({ widgetId: widget.id });
  return widget; // both writes commit together, or both roll back
}
```

The interceptor opens a `QueryRunner` transaction before the handler runs,
attaches it to the request, commits on success, and rolls back on any thrown
error — giving multi-write handlers ACID guarantees instead of each
repository call committing independently. `@TransactionManager()` pulls the
transactional `EntityManager` back out for the handler (and anything it calls
that accepts a manager) to use; using it without `@Transactional()` throws
rather than silently falling back to a non-transactional connection.

This existed in the codebase but was unexported, untested and unused; this
change fixes it to use TypeORM 0.3's `DataSource`/`InjectDataSource` (the
previous `Connection`/`InjectConnection` pair is the deprecated 0.2 API),
exports it from `@app/common`, and adds unit-test coverage
(`libs/common/src/interceptors/transaction.interceptor.spec.ts`,
`libs/common/src/decorators/transaction-manager.decorator.spec.ts`).

For a single-repository write, TypeORM's own `repository.save()` /
`manager.transaction()` already wrap each call in a transaction — reach for
`@Transactional()` specifically when a handler needs to make **multiple**
related writes atomically.

## Migrations

`synchronize` (auto-DDL from entity metadata) is fine for local development —
`DB_SYNCHRONIZE=true` in `.env.example` — but it must never run against a
database that matters: it can silently drop columns/tables to reconcile the
schema, and it isn't reviewable the way a migration file is. Version-controlled
migrations now exist for that:

```bash
npm run migration:generate -- src/database/migrations/DescriptiveName  # diff entities vs. DB, write a migration
npm run migration:create -- src/database/migrations/DescriptiveName    # blank migration file
npm run migration:run     # apply pending migrations
npm run migration:revert  # roll back the most recent migration
npm run migration:show    # list applied / pending migrations
```

These use a standalone `DataSource` (`src/database/data-source.ts`) since the
TypeORM CLI runs outside of Nest's dependency injection and can't use
`DatabaseConfig`. `DatabaseConfig` itself sets `migrationsRun: false` — CI/CD
should run `npm run migration:run` as an explicit deploy step, so a broken
migration fails the deploy rather than crash-looping the app on boot.

### ⚠️ No baseline migration yet

This repository's schema has been managed by `synchronize` since its first
commit, so there is no migration that creates the 45 existing tables — only
the one new migration added by this PR
(`1787847457730-AddTransactionIntegrityConstraints.ts`), which alters an
already-existing `transactions` table. **Do not run `migration:run` against
a database that doesn't already have the full schema** (e.g. from
`synchronize`); it will fail on the first `ALTER TABLE`.

Before any environment can rely on migrations instead of `synchronize`,
someone with a live Postgres instance needs to either:

1. Run `npm run migration:generate` against a fully-synchronized database to
   snapshot the current schema as a baseline migration, or
2. Use `typeorm migration:create` to hand-write one and verify it against a
   real database.

Both need a running Postgres to produce and verify — this environment has
Docker but no running daemon (`docker ps` failed: "error during connect ...
the system cannot find the file specified", i.e. Docker Desktop isn't
started), so it isn't done here. Recommended next step: whoever picks this up
next runs `docker compose up -d postgres`, `npm run start:dev` once
(so `synchronize` builds the full schema), then `npm run migration:generate`
against it, and commits the result as the first migration, before this new
migration.

### Example migration

`AddTransactionIntegrityConstraints1787847457730` demonstrates the pattern
end to end — a `CHECK` constraint (`transactions.amount > 0`, matching the
`@Check` now declared on the `Transaction` entity so `synchronize` and
migrations agree) and a composite index for the transaction-history query
(`userId` + `status`, ordered by `createdAt`). It has not been run against a
live database in this environment for the reason above; its SQL was reviewed
by hand rather than executed. Treat it as a reference implementation to
validate (`migration:run` then `migration:revert`) against a real database
before relying on it in a deployed environment.

## Data validation & constraints

Two layers, deliberately overlapping:

- **Application layer:** `class-validator` DTOs on every controller input.
- **Database layer:** `NOT NULL`/`unique` column options and now `@Check`
  constraints on the entities, enforced regardless of which code path writes
  the row. The `transactions.amount > 0` check above is the first explicit
  example; extending the same pattern (e.g. non-negative balances, valid
  enum-backed status transitions) to other entities is straightforward
  follow-up work once there's a baseline migration to build on.

## Audit trail

Already implemented — see [`docs/audit-logging.md`](audit-logging.md) and
`src/modules/audit/`. A global interceptor records every request
(actor, action, outcome, before/after state for data changes) to an
append-only `audit_logs` table with a 7-year minimum retention
(`AUDIT_RETENTION_YEARS`), plus GDPR export and compliance-report endpoints.
No changes needed for this issue.

## Out of scope for this change

Issue #12's acceptance criteria include several items that are infrastructure
and operations decisions, not application code, and that this PR does not
attempt — implementing them here would mean guessing choices (backup target,
sharding architecture) the codebase gives no basis for:

- **Automated, verified backups.** Needs a chosen backup target (managed
  Postgres provider snapshot? `pg_dump` to object storage on a cron?) and a
  restore-verification job. No such target is configured anywhere in this
  repo or its Docker/CI setup.
- **Disaster recovery (RPO < 5 min, RTO < 15 min).** An RPO under 5 minutes
  effectively requires continuous WAL streaming/replication, which is an
  infrastructure/hosting decision (e.g. managed Postgres with PITR, or a
  standby replica) — not something expressed in application code.
- **Sharding strategy for 10x growth.** No target approach is indicated
  anywhere in the codebase (single `DataSource`, no tenant/shard key on any
  entity, no read-replica routing). Picking one (e.g. Citus, application-level
  sharding by a tenant/user key, or simply read replicas + partitioning) is a
  significant architectural decision that should be made deliberately, with
  the team, against real growth data — not guessed at in a persistence-module
  PR.
- **A measured >40% latency reduction from pooling.** Pooling is now
  configured (above), but proving a percentage improvement needs a load-test
  harness and a before/after run against a live database, which this sandbox
  environment doesn't have.
- **Load tests validating performance targets.** Same constraint — no live
  database available here to generate a load-test baseline against.

These are called out explicitly rather than left implicit so the next person
picking up #12 knows exactly what decisions are still needed.
