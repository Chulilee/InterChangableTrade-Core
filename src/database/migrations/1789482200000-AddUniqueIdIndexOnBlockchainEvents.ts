import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a unique index on `blockchain_events.uniqueId` so that the indexer's
 * `INSERT ... ON CONFLICT DO NOTHING` is actually enforced by the database.
 *
 * Without a unique constraint the `orIgnore()` call in
 * `EventIndexerService.deduplicateAndPersist` is inert, so any replay of a
 * ledger range (reorg, retry, cursor rewind, restart) inserted duplicate rows.
 *
 * Existing rows are de-duplicated first (keeping the earliest `createdAt` per
 * `uniqueId`), otherwise the unique index cannot be created.
 */
export class AddUniqueIdIndexOnBlockchainEvents1789482200000
  implements MigrationInterface
{
  name = 'AddUniqueIdIndexOnBlockchainEvents1789482200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('blockchain_events');
    if (!table) {
      return;
    }

    // De-duplicate: keep one row per uniqueId (the earliest createdAt).
    await queryRunner.query(`
      DELETE FROM "blockchain_events"
      WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY "uniqueId" ORDER BY "createdAt" ASC
                 ) AS rn
          FROM "blockchain_events"
        ) ranked
        WHERE rn > 1
      )
    `);

    const indexExists = table.indices.some(
      (index) => index.name === 'UQ_blockchain_events_unique_id',
    );
    if (!indexExists) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_blockchain_events_unique_id"
        ON "blockchain_events" ("uniqueId")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_blockchain_events_unique_id"
    `);
  }
}
