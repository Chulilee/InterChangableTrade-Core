# Authentication & Authorization Module

Comprehensive auth module providing secure authentication, authorization, and audit capabilities for the InterChangableTrade Core API.

---

## Features

### 1. **Multiple Authentication Strategies**

#### Email/Password Authentication
- **Registration** (`POST /api/auth/register`)
- **Login** (`POST /api/auth/login`)
- Password hashing with bcrypt (10 rounds)
- Returns both access token (JWT) and refresh token on success

#### Stellar Wallet Authentication
- **Challenge Request** (`POST /api/auth/stellar/challenge`)  
  Client requests a nonce for their Stellar public key
- **Verify Signature** (`POST /api/auth/stellar/verify`)  
  Client signs nonce with private key; server verifies Ed25519 signature
- Automatically creates user account on first successful authentication
- No password required for wallet-only accounts

#### API Key Authentication
- **Create Key** (`POST /api/auth/api-keys`)  
  Returns plain key **once** — never stored in DB
- **Authenticate** via `X-Api-Key` header (use `ApiKeyAuthGuard`)
- Optional expiry date and scope restrictions
- Last-used timestamp tracking

---

### 2. **Session Management**

#### Refresh Token Flow
- **Refresh** (`POST /api/auth/refresh`)  
  Exchanges refresh token for a new access + refresh token pair
- **Rotation on refresh**: old token is automatically revoked
- Tokens stored as bcrypt hashes for security
- Tracks device, IP, and user-agent for audit purposes

#### Logout
- **Single Logout** (`POST /api/auth/logout`)  
  Revokes a specific refresh token
- **Logout All** (`POST /api/auth/logout-all`)  
  Revokes all tokens for the current user (forces re-login everywhere)

#### Token Expiry
- **Access Token**: `JWT_EXPIRES_IN` (default: 1 hour)
- **Refresh Token**: `JWT_REFRESH_EXPIRES_IN` (default: 30 days)

---

### 3. **Role-Based Access Control (RBAC)**

#### Available Roles
- `UserRole.USER` (default)
- `UserRole.ADMIN`

#### Usage
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Get('admin/dashboard')
async adminDashboard() { ... }
```

#### Guards
- **`JwtAuthGuard`**: Validates access token (JWT)
- **`ApiKeyAuthGuard`**: Validates API key from `X-Api-Key` header
- **`RolesGuard`**: Enforces `@Roles(...)` metadata

---

### 4. **Rate Limiting**

Prevents brute-force attacks by tracking failed login attempts in Redis:
- **Max Failures**: 5 within a 5-minute window
- **Lockout Duration**: 15 minutes
- **Lockout Scope**: Per email address
- Failed attempts are cleared on successful authentication

---

### 5. **Audit Logging**

Every authentication event is recorded in `auth_audit_logs`:
- Event types include `register`, `login_success`, `login_failed`, `logout`, `token_refresh`, `stellar_auth_success`, `api_key_created`, etc.
- Captures user ID, IP address, user agent, and custom metadata
- Failures never interrupt auth flows (logged only)

---

### 6. **Password Reset**

#### Flow
1. **Request Reset** (`POST /api/auth/password-reset/request`)  
   Server generates single-use token, sends via email (TODO: integrate with NotificationsModule)
2. **Confirm Reset** (`POST /api/auth/password-reset/confirm`)  
   Client submits token + new password; server validates and updates password
3. All refresh tokens are revoked after successful password reset

#### Security
- Tokens are bcrypt-hashed and expire after 1 hour
- Tokens are single-use (marked as `isUsed` after redemption)
- Old tokens are invalidated when a new reset is requested

---

## Environment Configuration

Add the following to your `.env` file:

```env
# JWT
JWT_SECRET=your-secret-key-min-16-chars
JWT_EXPIRES_IN=3600s
JWT_REFRESH_EXPIRES_IN=2592000  # 30 days in seconds
```

---

## Database Entities

| Entity | Purpose |
|--------|---------|
| `RefreshToken` | Stores hashed refresh tokens with device/IP metadata |
| `ApiKey` | Stores hashed API keys with scopes and expiry |
| `AuthAuditLog` | Immutable audit records for all auth events |
| `StellarAuthChallenge` | Short-lived nonces for Stellar wallet challenge-response |
| `PasswordResetToken` | Single-use password reset tokens |

All entities extend `BaseEntity` (UUID + timestamps).

---

## API Reference

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login with email/password |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/stellar/challenge` | Request Stellar wallet challenge |
| `POST` | `/api/auth/stellar/verify` | Verify Stellar signature |
| `POST` | `/api/auth/password-reset/request` | Request password reset |
| `POST` | `/api/auth/password-reset/confirm` | Confirm password reset |

### Protected Endpoints (require JWT)

| Method | Path | Description | Guard |
|--------|------|-------------|-------|
| `GET` | `/api/auth/me` | Get current user | `JwtAuthGuard` |
| `POST` | `/api/auth/logout` | Logout (revoke token) | `JwtAuthGuard` |
| `POST` | `/api/auth/logout-all` | Logout all sessions | `JwtAuthGuard` |
| `POST` | `/api/auth/api-keys` | Create API key | `JwtAuthGuard` |
| `GET` | `/api/auth/api-keys` | List API keys | `JwtAuthGuard` |
| `DELETE` | `/api/auth/api-keys/:id` | Revoke API key | `JwtAuthGuard` |
| `GET` | `/api/auth/api-key/verify` | Verify API key | `ApiKeyAuthGuard` |

---

## Security Best Practices

✅ **Implemented:**
- Password hashing with bcrypt (10 rounds)
- Refresh token rotation on use
- Token storage as bcrypt hashes (not plaintext)
- Rate limiting on failed login attempts
- Audit logging for all auth events
- Single-use password reset tokens with 1-hour expiry
- Stellar signature verification with nonce replay protection
- API keys never stored in plaintext

⚠️ **Additional Recommendations:**
- Use HTTPS in production (enforced via Helmet middleware)
- Rotate `JWT_SECRET` periodically
- Set strong `JWT_SECRET` (>= 32 chars)
- Monitor audit logs for suspicious patterns
- Implement IP-based rate limiting in addition to email-based
- Add CAPTCHA for registration/login endpoints if under attack
- Integrate email notifications for sensitive actions (password reset, new API key, etc.)

---

## Testing

Run the integration test suite:

```bash
npm run test:e2e -- auth.integration.spec
```

Test coverage includes:
- Registration & login
- Refresh token flow (issuance + rotation)
- Logout & logout-all
- API key creation & usage
- JWT guard enforcement
- API key guard enforcement
- Rate limiting (requires running Redis)

---

## TODOs

- [ ] OAuth 2.0 provider integration (Google, GitHub)
- [ ] Email verification on registration
- [ ] Two-factor authentication (TOTP)
- [ ] Webhook notifications for auth events
- [ ] Integration with NotificationsModule for password reset emails
- [ ] Admin endpoints for managing user sessions
- [ ] Scope-based permission system beyond RBAC roles

---

## Acceptance Criteria Status

| Requirement | Status |
|-------------|--------|
| Stellar wallet authentication integrates seamlessly | ✅ Implemented |
| OAuth flow follows industry standards | ⏳ Pending |
| API key management is secure and auditable | ✅ Implemented |
| Sessions timeout correctly after inactivity | ✅ Implemented (via token expiry) |
| RBAC prevents unauthorized operations | ✅ Implemented |
| Failed auth attempts trigger rate limits | ✅ Implemented |
| Token expiration is handled gracefully | ✅ Implemented (refresh flow) |
| All auth events are audited with user context | ✅ Implemented |
| Cross-platform sessions remain consistent | ✅ Implemented (refresh tokens) |
| Security testing confirms no common vulnerabilities | ⏳ Pending comprehensive audit |

---

## Architecture Diagram

```
┌─────────────────┐
│  Auth Controller│
└────────┬────────┘
         │
    ┌────▼────────────────────────────────┐
    │         Auth Service                │
    │  ┌──────────────────────────────┐   │
    │  │ Email/Password Login         │   │
    │  │ Registration                 │   │
    │  │ Token Refresh & Logout       │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │ StellarAuthService           │   │
    │  │  - Challenge issuance        │   │
    │  │  - Signature verification    │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │ ApiKeysService               │   │
    │  │  - Create/List/Revoke        │   │
    │  │  - Validation                │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │ AuthRateLimiterService       │   │
    │  │  - Track failures (Redis)    │   │
    │  │  - Lock/unlock               │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │ AuthAuditService             │   │
    │  │  - Record all events         │   │
    │  └──────────────────────────────┘   │
    └──────────────────────────────────────┘
              │           │
              │           └─────────┐
        ┌─────▼──────┐         ┌────▼─────┐
        │ PostgreSQL │         │  Redis   │
        │ (TypeORM)  │         │ (ioredis)│
        └────────────┘         └──────────┘
```

---

For questions or support, see the main project [README](../../../README.md).
