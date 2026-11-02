import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

/**
 * Computes the deterministic `lookupHash` persisted next to each opaque
 * credential (refresh token, password-reset token, API key).
 *
 * Why this exists
 * ---------------
 * Credentials are stored as salted bcrypt hashes, and bcrypt provides no way to
 * answer "which row matches this token?" short of running `bcrypt.compare` on
 * every candidate — 60-100 ms of CPU per row. Three unauthenticated/hot paths
 * used to do exactly that, making a full-table CPU-exhaustion DoS trivial.
 *
 * Persisting `HMAC-SHA256(pepper, rawCredential)` in an indexed, unique column
 * lets each path resolve a single row with one `SELECT ... WHERE lookupHash = $1`
 * and then run exactly one bcrypt compare. The HMAC is keyed so the digest is
 * useless without the server-side pepper, and bcrypt remains the source of
 * truth for verification — the digest is only an index.
 */
@Injectable()
export class AuthTokenLookupService {
  private readonly logger = new Logger(AuthTokenLookupService.name);
  private readonly pepper: string;

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('auth.tokenPepper');
    if (configured && configured.length > 0) {
      this.pepper = configured;
    } else {
      // A dedicated pepper is preferable (it can be rotated independently of
      // JWT signing), but falling back to JWT_SECRET keeps existing deployments
      // booting. Both are server-side secrets and neither is used to verify a
      // credential — the indexed digest never replaces the bcrypt check.
      this.pepper = configService.get<string>('jwt.secret') ?? '';
      this.logger.warn(
        'AUTH_TOKEN_PEPPER is not set; falling back to JWT_SECRET for credential lookup hashes. Set a dedicated AUTH_TOKEN_PEPPER in production.',
      );
    }
  }

  /**
   * Returns the hex-encoded HMAC-SHA256 of `rawCredential`.
   *
   * Stable for a given pepper, so it can be persisted and compared by equality,
   * and one-way, so a database reader cannot recover the credential from it.
   */
  digest(rawCredential: string): string {
    return createHmac('sha256', this.pepper)
      .update(rawCredential, 'utf8')
      .digest('hex');
  }
}
