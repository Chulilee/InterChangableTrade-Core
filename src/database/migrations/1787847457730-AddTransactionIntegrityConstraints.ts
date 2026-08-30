import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a data-validation constraint and a query-pattern index to
 * `transactions`.
 *
 * This is the first migration in the project (see docs/database.md for why
 * there is no baseline migration yet): it assumes the `transactions` table
 * already exists, created either by `synchronize` in a dev environment or by
 * a future baseline migration. Run it only after that precondition holds.
 */
export class AddTransactionIntegrityConstraints1787847457730 implements MigrationInterface {
  name = 'AddTransactionIntegrityConstraints1787847457730';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Data validation: a transaction moving zero or negative value is an
    // invalid state that should never reach the database, regardless of
    // which application-layer check might have been skipped.
    await queryRunner.query(`
      ALTER TABLE "transactions"
      ADD CONSTRAINT "CHK_transactions_amount_positive" CHECK ("amount" > 0)
    `);

    // Query performance: the transaction-history endpoints page through a
    // single user's transactions filtered by status, most-recent first. The
    // existing single-column indexes on `userId` and `status` each narrow
    // the search independently; this composite index lets Postgres satisfy
    // that exact filter+sort in one index scan instead of intersecting two
    // bitmap scans and then sorting.
    await queryRunner.query(`
      CREATE INDEX "IDX_transactions_user_status_created"
      ON "transactions" ("userId", "status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_transactions_user_status_created"
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
      DROP CONSTRAINT IF EXISTS "CHK_transactions_amount_positive"
    `);
  }
}
