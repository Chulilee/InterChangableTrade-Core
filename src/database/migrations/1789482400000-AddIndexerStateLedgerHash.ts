import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a ledger hash to the indexer state table.
 *
 * Reorg detection cannot rely on ledger sequence numbers alone: Stellar ledger
 * sequences are strictly monotonic, so a rollback to a different ledger at the
 * same sequence is invisible unless the hash of the last indexed ledger is
 * stored and compared against the hash reported by Horizon.
 */
export class AddIndexerStateLedgerHash1789482400000 implements MigrationInterface {
  name = 'AddIndexerStateLedgerHash1789482400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "indexer_state" ADD "ledger_hash" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "indexer_state" DROP COLUMN "ledger_hash"`,
    );
  }
}
