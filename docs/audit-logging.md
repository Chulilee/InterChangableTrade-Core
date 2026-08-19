# Audit Logging & Compliance Reporting

The audit module (`src/modules/audit`) captures system activity as **immutable,
append-only** records for compliance, security investigation and regulatory
reporting.

## What is captured

A global interceptor (`AuditInterceptor`, registered via `APP_INTERCEPTOR`)
writes one record for every HTTP request once it completes — on success and on
failure. Each record includes:

| Field                                 | Meaning                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `createdAt`                           | When the event occurred (the only timestamp)                                 |
| `category`                            | `user_action` / `admin_action` / `system_event` / `data_change` / `security` |
| `action`                              | Grouped action, e.g. `GET /api/trades/:id`                                   |
| `outcome`                             | `success` / `failure`                                                        |
| `userId`, `userRole`                  | The authenticated actor and their role                                       |
| `resourceType`, `resourceId`          | The resource acted upon                                                      |
| `httpMethod`, `path`, `statusCode`    | Request/response details                                                     |
| `durationMs`                          | Handler wall-clock time                                                      |
| `ipAddress`, `userAgent`, `requestId` | Origin and correlation id                                                    |
| `beforeState`, `afterState`           | Before/after snapshots for data-change events                                |

Modules that mutate data can also inject `AuditService` and call
`append(...)`/`record(...)` directly to attach `beforeState`/`afterState`
snapshots that the generic request interceptor cannot infer.

### Performance

`AuditService.record()` is fire-and-forget: the interceptor hands the record off
without `await`ing the database write, so audit capture stays off the request's
critical path and adds negligible latency. A persistence failure is logged, not
thrown, so auditing can never break the request it observes.

## Immutability

Audit records are never updated or deleted by the application:

- The `AuditLog` entity has **no** `@UpdateDateColumn` — there is no update path.
- `AuditService` exposes only `append`/`record` for writes; the controller has
  no create/update/delete endpoint.
- In a deployed environment, harden this at the database level by revoking
  `UPDATE`/`DELETE` on `audit_logs` from the application role:

  ```sql
  REVOKE UPDATE, DELETE ON audit_logs FROM app_role;
  ```

## Retention

Records are retained for a minimum of **7 years** (`AUDIT_RETENTION_YEARS`) per
common regulatory record-keeping requirements. `AuditService.findArchivable()`
returns records older than the window as candidates for archival to cold
storage; it only reads — nothing is deleted from the append-only table.

## API

All endpoints are admin-only (`JwtAuthGuard` + `RolesGuard` + `@Roles(ADMIN)`).

| Method & path                     | Purpose                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /audit/logs`                 | Paginated, filterable search (user, action, category, outcome, resource type/id, date range) |
| `GET /audit/logs/:id`             | Fetch a single record                                                                        |
| `GET /audit/dashboard/activities` | Last 100 activities for the real-time security dashboard                                     |
| `GET /audit/export/:userId`       | GDPR data-subject export of all records for a user                                           |
| `POST /audit/reports`             | Generate a compliance report and download it                                                 |

### Compliance reports

`POST /audit/reports` accepts:

```json
{
  "type": "transactions | user_activity | admin_actions | security",
  "format": "csv | pdf | json",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T23:59:59.999Z",
  "userId": "<required for user_activity>"
}
```

The response streams the report as a downloadable file (`Content-Disposition:
attachment`). CSV is RFC 4180; PDF is produced by a self-contained writer (no
external dependency).

## GDPR

- **Data export:** `GET /audit/export/:userId` returns the subject's full
  activity record.
- **Deletion tracking:** deletions flow through the interceptor as
  `data_change` actions with the resource type/id, so the fact and time of a
  deletion is itself auditable.

## Testing

Unit tests cover the capture logic, search/report generation, immutability
surface and the report writers:

- `src/modules/audit/audit.service.spec.ts`
- `src/modules/audit/interceptors/audit.interceptor.spec.ts`
- `src/modules/audit/reporting/report-writers.spec.ts`

Run them with `npm test`. Integration/e2e coverage (booting the app against
Postgres + Redis) runs via the `integration` job in `.github/workflows/ci.yml`.
