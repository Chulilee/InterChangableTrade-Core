import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persisted schedule state for `saved_reports` (issue #90).
 *
 * `scheduleReport()` previously computed `nextRunAt` but never saved it,
 * so no report was ever due. These columns store the frequency and the
 * recipient list alongside `scheduleCron`/`nextRunAt` so the scheduler can
 * poll a valid row and delivery never reports "sent" with no recipients.
 */
export class AddSavedReportSchedulingColumns1789501000000 implements MigrationInterface {
  name = 'AddSavedReportSchedulingColumns1789501000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_reports" ADD IF NOT EXISTS "scheduleFrequency" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_reports" ADD IF NOT EXISTS "recipients" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_reports" DROP COLUMN IF EXISTS "recipients"`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_reports" DROP COLUMN IF EXISTS "scheduleFrequency"`,
    );
  }
}
