# Pool analytics

`PoolAnalyticsService.getPoolMetrics()` reports TVL together with its 24h and
7d change. Both changes come from `findValueAtOffset(metrics, hoursBack)` in
`src/modules/analytics/services/pool-analytics.service.ts`.

## Offset semantics

`findValueAtOffset` looks **backwards** from the newest sample:

- The newest and oldest samples are selected by timestamp, not array order, so
  the result is independent of the repository's `ORDER BY`.
- The target time is `newest.timestamp - hoursBack`.
- A sample within one hour of the target is treated as the value at that
  offset.
- If the target is older than the oldest available sample, the result has
  `outOfRange: true` and `value: null`.
- If no sample is close enough, `value` is `null`.
- A real sample whose value is `0` returns `value: 0`.

`null` and `0` are therefore distinguishable. `percentChange()` reports a
change of `0` for both "no prior sample" and "prior value was zero", and never
divides by zero. When an offset is out of range the service logs a debug line
naming the pool and the missing window.
