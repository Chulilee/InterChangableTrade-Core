import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `amountIn` column to the route cache.
 *
 * Cached routes are input-dependent: an estimate computed for a 100-unit
 * swap is not valid for a 1,000,000-unit order. Previously the cache was
 * looked up by token pair only, so any cached route — regardless of the
 * amount it was priced for — was served for every later request (issue #97).
 * Existing rows are left NULL and therefore never match an amount-scoped
 * cache lookup, which is the safe behaviour.
 */
export class AddRouteCacheAmountIn1789600000000 implements MigrationInterface {
  name = 'AddRouteCacheAmountIn1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "route_cache" ADD "amountIn" numeric(30,7)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "route_cache" DROP COLUMN "amountIn"`);
  }
}
