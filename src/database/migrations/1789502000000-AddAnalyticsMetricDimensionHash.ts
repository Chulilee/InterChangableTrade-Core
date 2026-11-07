import { MigrationInterface, QueryRunner } from 'typeorm';
import { createHash } from 'crypto';

/**
 * Aligns the `analytics_metrics` unique grain with upsert identity (issue #91).
 *
 * Old grain: (metricType, aggregation, timestamp) — collapsed different
 * assets/users consign into one row. New grain adds dimensionHash
 * (sha256 of assetCode|assetIssuer|userId|source, '' for missing), so
 * distinct assets get distinct rows while identical metrics still upsert.
 */
export class AddAnalyticsMetricDimensionHash1789502000000 implements MigrationInterface {
  name = 'AddAnalyticsMetricDimensionHash1789502000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_metrics" ADD IF NOT EXISTS "dimensionHash" character varying(64) NOT NULL DEFAULT ''`,
    );

    // Backfill existing rows with the same hash the service computes, so
    // the new unique index cannot collide legacy rows of different grain.
    const rows: Array<{
      id: string;
      assetCode: string | null;
      assetIssuer: string | null;
      userId: string | null;
      source: string | null;
    }> = await queryRunner.query(
      `SELECT "id", "assetCode", "assetIssuer", "userId", "source" FROM "analytics_metrics"`,
    );
    for (const row of rows) {
      const dimensionHash = createHash('sha256')
        .update(
          [row.assetCode ?? '', row.assetIssuer ?? '', row.userId ?? '', row.source ?? ''].join(
            '|',
          ),
        )
        .digest('hex');
      await queryRunner.query(
        `UPDATE "analytics_metrics" SET "dimensionHash" = $1 WHERE "id" = $2`,
        [dimensionHash, row.id],
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_785a09b65304d32ac1d7998c37"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_analytics_metrics_grain_hash" ON "analytics_metrics" ("metricType", "aggregation", "timestamp", "dimensionHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_analytics_metrics_grain_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_metrics" DROP COLUMN IF EXISTS "dimensionHash"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_785a09b65304d32ac1d7998c37" ON "analytics_metrics" ("metricType", "aggregation", "timestamp")`,
    );
  }
}
