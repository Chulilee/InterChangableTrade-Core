import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backstop for the escrow double-spend fixed in `EscrowService.releaseFunds`:
 * even if application-layer guards are bypassed or two releases race, the
 * database refuses to store a `releasedAmount` greater than the escrow's
 * total `amount`.
 *
 * Any pre-existing violating rows are corrected first (clamped to `amount`)
 * so the constraint can be created.
 */
export class AddEscrowReleasedAmountCheck1789482300000
  implements MigrationInterface
{
  name = 'AddEscrowReleasedAmountCheck1789482300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('escrow_accounts');
    if (!table) {
      return;
    }

    // Clamp any existing over-release so the CHECK can be added.
    await queryRunner.query(`
      UPDATE "escrow_accounts"
      SET "releasedAmount" = "amount"
      WHERE "releasedAmount" > "amount"
    `);

    const exists = table.checks.some(
      (check) => check.name === 'CHK_escrow_released_lte_amount',
    );
    if (!exists) {
      await queryRunner.query(`
        ALTER TABLE "escrow_accounts"
        ADD CONSTRAINT "CHK_escrow_released_lte_amount"
        CHECK ("releasedAmount" <= "amount")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "escrow_accounts"
      DROP CONSTRAINT IF EXISTS "CHK_escrow_released_lte_amount"
    `);
  }
}
