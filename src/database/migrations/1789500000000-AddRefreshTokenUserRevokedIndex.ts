import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite index on `("userId", "isRevoked")` for `refresh_tokens` (issue #88).
 *
 * `logout(id)` and `logoutAll(id)` filter by exactly these two columns, so
 * before this index every such query scanned the user's token history. The
 * unique `lookupHash` index covers token authentication; this one covers the
 * account-scoped revocation paths.
 */
export class AddRefreshTokenUserRevokedIndex1789500000000 implements MigrationInterface {
  name = 'AddRefreshTokenUserRevokedIndex1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_user_is_revoked" ON "refresh_tokens" ("userId", "isRevoked")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_tokens_user_is_revoked"`,
    );
  }
}
