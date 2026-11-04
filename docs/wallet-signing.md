# Custodial Wallet Signing Policy

`WalletService` holds encrypted Stellar secret keys and will sign an envelope on
behalf of a wallet owner. Because a signature is irreversible, the endpoint is
treated as a privileged operation rather than a generic XDR utility.

## What is enforced

Every envelope submitted to `POST /api/wallets/:id/sign-transaction` is checked
before the encrypted secret key is decrypted:

1. **Source binding** — `transaction.source` must equal `wallet.publicKey`.
   Anything else is rejected with `403`. The multisig path applies the same
   rule.
2. **Operation allowlist** — every operation type must appear in
   `WALLET_SIGNING_ALLOWED_OPERATIONS`. A disallowed type is rejected with
   `400`, and the error lists the allowed set.
3. **High-risk operations** — `setOptions` and `accountMerge` require:
   - the `admin` role on the authenticated user (`403` otherwise), and
   - a live step-up token (`401` otherwise).
4. **Size bound** — `unsignedXdr` is limited to 4096 characters at the DTO and
   service layers. XDR parsing is synchronous, so unbounded input is a cheap
   CPU/memory DoS.
5. **Fail-closed network selection** — the signer reads
   `STELLAR_NETWORK_PASSPHRASE` and refuses to sign if it is absent. There is no
   testnet fallback.
6. **Fee-bump rejection** — fee-bump envelopes are not accepted by the
   single-signer endpoint, because their fee source is not the wallet account
   the operation is bound to.
7. **Audit emission** — every signature (direct or decorated) appends an
   `AuditService` record with the transaction hash and the operation set before
   the signed XDR is returned.

## Configuration

```env
# Comma-separated Stellar operation types the custodial signer may authorise.
# Default: payment
WALLET_SIGNING_ALLOWED_OPERATIONS=payment
```

Roll out by adding operation names explicitly, for example:

```env
WALLET_SIGNING_ALLOWED_OPERATIONS=payment,pathPaymentStrictSend
```

Adding `setOptions` or `accountMerge` to this list is necessary but **not
sufficient**: they still require the admin role and a step-up token.

## Step-up flow

1. The user authenticates normally and receives an access + refresh token pair.
2. The client calls `POST /api/auth/step-up` with its refresh token:

   ```json
   { "refreshToken": "<refresh token>" }
   ```

3. The response contains a short-lived (five minute) `stepUpToken`.
4. For a `setOptions` or `accountMerge` envelope, send it in the
   `x-step-up-token` header when calling `sign-transaction`.

Step-up tokens carry a purpose marker that `JwtStrategy` rejects, so they cannot
be used as general API bearer credentials. An ordinary access token cannot be
used in place of a step-up token.

## Multisig note

The multisig pipeline (`POST /multisig/transactions/:txId/signatures`) also binds
decorated signatures to the wallet source account and audits them. Operation
authorisation there is governed by the pooled transaction's on-chain threshold
rather than the single-signer allowlist, so a multisig `setOptions` proposal is
not blocked by the admin gate.

## Failure responses

| Condition | Status |
| --- | --- |
| Envelope source is another account | `403` |
| Operation outside the allowlist | `400` |
| High-risk operation without admin role | `403` |
| High-risk operation without a valid step-up token | `401` |
| `unsignedXdr` over 4096 characters | `400` |
| Missing network passphrase | `500` (refuses to sign) |
