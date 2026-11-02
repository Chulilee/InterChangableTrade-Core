# Rate Limiting & Client Identity

Tracks [#80](https://github.com/Chulilee/InterChangableTrade-Core/issues/80).

The global `RateLimitGuard` (`src/modules/rate-limiting/guards/rate-limit.guard.ts`)
runs before authentication on every route. It buckets requests under one of
three identifiers, in priority order:

| Priority | Key                    | Source                                                    |
| -------- | ---------------------- | --------------------------------------------------------- |
| 1        | `user:<uuid>`          | `request.user.id` (populated by JWT/API-key auth)          |
| 2        | `apikey:<sha256-prefix>` | first 32 hex chars of SHA-256 of the raw `X-Api-Key`     |
| 3        | `ip:<address>`         | `request.ip`, falling back to `request.socket.remoteAddress` |

## Expected proxy topology

`trust proxy` is configured once in `src/main.ts` from `TRUST_PROXY_HOPS`
(default `1`). The supported deployment shape is:

```
client ──▶ TLS-terminating load balancer / ingress (trusted hop) ──▶ app
```

With `TRUST_PROXY_HOPS=1`, Express strips the untrusted client-supplied
`X-Forwarded-For` prefix and resolves `request.ip` from the address appended by
the trusted hop. Every trusted hop **must** append to (not overwrite)
`X-Forwarded-For`; otherwise the original client address is lost.

Set `TRUST_PROXY_HOPS=0` when the app is exposed directly to clients. Express
then ignores `X-Forwarded-For` completely and `request.ip` is the socket peer.

Increasing the hop count is only correct if you actually run that many trusted
proxies: every extra trusted hop lets a client spoof one more `X-Forwarded-For`
entry.

## Why the guard never parses `X-Forwarded-For` itself

`X-Forwarded-For` is a client-controlled header. Reading its first entry
directly lets a caller rotate the value per request and receive a fresh
`ip:` bucket every time, which is a complete bypass of the only control in front
of unauthenticated endpoints such as `POST /api/auth/login`. Client IPs are
therefore only ever obtained from `request.ip`, after Express has applied the
configured hop count. The same rule applies everywhere else in `src/` (audit
logging, auth request context, escrow/compliance actors).

## Why API keys are hashed into the bucket name

The raw API key is a bearer secret. Using it verbatim as a Redis key would copy
that secret into `SCAN`/`MONITOR`/`SLOWLOG` output, AOF/RDB persistence and
backups. The guard only needs a stable, collision-resistant identifier, so it
stores `sha256(rawKey)` truncated to 12 bytes:

```ts
const id = createHash('sha256').update(rawKey).digest('hex').slice(0, 32);
return `apikey:${id}`;
```

The hash is one-way, so a leaked Redis dump does not yield a usable key. Once
authentication has resolved the request, the `user:<id>` branch takes over for
JWT/API-key callers; if a request only carries a resolved `apiKeyId`, the guard
buckets on `apikey:<apiKeyId>` rather than re-hashing the header.
