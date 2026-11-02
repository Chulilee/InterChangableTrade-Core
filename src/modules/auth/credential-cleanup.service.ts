import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { StellarAuthChallenge } from './entities/stellar-auth-challenge.entity';

export interface CredentialCleanupResult {
  refreshTokens: number;
  passwordResetTokens: number;
  stellarChallenges: number;
}

/** Fallback when `auth.cleanupIntervalMs` is not configured: hourly. */
const DEFAULT_CLEANUP_INTERVAL_MS = 3_600_000;

/**
 * How long a rotated/revoked refresh token is kept before deletion. Keeping a
 * short window preserves the ability to investigate token-reuse anomalies while
 * still bounding the table (and the `refresh_tokens` scan surface) over time.
 */
const REVOKED_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Periodically purges credential rows that can no longer authenticate anyone.
 *
 * Before this existed, expired/revoked refresh tokens accumulated forever
 * (`JWT_REFRESH_EXPIRES_IN` is 30 days and nothing ever deleted a row), which is
 * what made the O(N) bcrypt verification paths in issue #81 unbounded. Lookup
 * is now O(1), and this job keeps the tables from growing without bound.
 *
 * Uses a plain `setInterval` rather than `@nestjs/schedule` so the fix does not
 * require a new runtime dependency. The timer is `unref`'d so it never keeps a
 * short-lived process (tests, CLI commands) alive.
 */
@Injectable()
export class CredentialCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CredentialCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepo: Repository<PasswordResetToken>,
    @InjectRepository(StellarAuthChallenge)
    private readonly challengeRepo: Repository<StellarAuthChallenge>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs =
      this.configService.get<number>('auth.cleanupIntervalMs') ??
      DEFAULT_CLEANUP_INTERVAL_MS;

    this.timer = setInterval(() => {
      void this.cleanupExpiredCredentials().catch((error: unknown) => {
        this.logger.error(
          `Credential cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Deletes expired/consumed credential rows.
   *
   * - Refresh tokens: expired, or revoked longer ago than the retention window.
   * - Password-reset tokens: expired or already used (single use).
   * - Stellar auth challenges: expired or already used.
   *
   * Exposed publicly so an operator/cron can trigger a pass explicitly and so
   * unit tests can assert the query shapes.
   */
  async cleanupExpiredCredentials(
    now: Date = new Date(),
  ): Promise<CredentialCleanupResult> {
    const revokedCutoff = new Date(now.getTime() - REVOKED_TOKEN_RETENTION_MS);

    const [refreshResult, resetResult, challengeResult] = await Promise.all([
      this.refreshTokenRepo
        .createQueryBuilder()
        .delete()
        .from(RefreshToken)
        .where('"expiresAt" <= :now', { now })
        .orWhere('"isRevoked" = true AND "revokedAt" <= :revokedCutoff', {
          revokedCutoff,
        })
        .execute(),
      this.resetTokenRepo
        .createQueryBuilder()
        .delete()
        .from(PasswordResetToken)
        .where('"expiresAt" <= :now', { now })
        .orWhere('"isUsed" = true')
        .execute(),
      this.challengeRepo
        .createQueryBuilder()
        .delete()
        .from(StellarAuthChallenge)
        .where('"expiresAt" <= :now', { now })
        .orWhere('"isUsed" = true')
        .execute(),
    ]);

    const result: CredentialCleanupResult = {
      refreshTokens: refreshResult.affected ?? 0,
      passwordResetTokens: resetResult.affected ?? 0,
      stellarChallenges: challengeResult.affected ?? 0,
    };

    this.logger.debug(
      `Purged credentials: ${result.refreshTokens} refresh tokens, ` +
        `${result.passwordResetTokens} password-reset tokens, ` +
        `${result.stellarChallenges} Stellar challenges`,
    );

    return result;
  }
}
