import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the deterministic credential lookup columns introduced for issue #81.
 *
 * `refresh_tokens`, `password_reset_tokens` and `api_keys` used to be searched
 * with `SELECT *` + one `bcrypt.compare` per row, because a salted bcrypt hash
 * cannot be matched by equality. Each table now carries
 * `lookupHash = HMAC-SHA256(pepper, rawCredential)` in a unique index, so
 * verification is one indexed lookup followed by exactly one bcrypt compare.
 *
 * The column is nullable: rows written before this migration cannot be
 * backfilled (the raw credentials are not recoverable from their bcrypt
 * hashes), so they keep `NULL` and simply stop validating. Outstanding refresh
 * tokens and API keys therefore have to be re-issued — documented in
 * CHANGELOG.md. Postgres unique indexes permit multiple `NULL`s, so the unique
 * constraint can be created before the backfill window closes.
 *
 * `stellar_auth_challenges` needs no new column: it already stores the nonce in
 * clear text under a unique index, which is the same O(1) lookup.
 */
export class AddCredentialLookupHashes1789482500000 implements MigrationInterface {
  name = 'AddCredentialLookupHashes1789482500000';

  /** Tables that gain a `lookupHash` column, with their unique index names. */
  private readonly credentialTables: Array<{
    table: string;
    index: string;
  }> = [
    { table: 'refresh_tokens', index: 'UQ_refresh_tokens_lookup_hash' },
    {
      table: 'password_reset_tokens',
      index: 'UQ_password_reset_tokens_lookup_hash',
    },
    { table: 'api_keys', index: 'UQ_api_keys_lookup_hash' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, index } of this.credentialTables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "lookupHash" character(64)`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON "${table}" ("lookupHash")`,
      );
    }

    // The cleanup job (CredentialCleanupService) deletes by expiry, so give it
    // an index instead of a sequential scan on every pass.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_expires_at" ON "refresh_tokens" ("expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_expires_at" ON "password_reset_tokens" ("expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stellar_auth_challenges_expires_at" ON "stellar_auth_challenges" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_stellar_auth_challenges_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_password_reset_tokens_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_tokens_expires_at"`,
    );

    for (const { table, index } of this.credentialTables) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "lookupHash"`,
      );
    }
  }
}
