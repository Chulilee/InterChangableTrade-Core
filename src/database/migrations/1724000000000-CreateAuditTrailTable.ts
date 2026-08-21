import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableIndex,
} from 'typeorm';

/**
 * Example versioned migration: creates the `audit_trails` table backing
 * {@link AuditTrail}, including its indexes and CHECK constraint.
 */
export class CreateAuditTrailTable1724000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_trails',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'actorId',
            type: 'varchar',
            length: '64',
            default: "'system'",
          },
          {
            name: 'action',
            type: 'varchar',
            length: '16',
            default: "'insert'",
          },
          { name: 'entityType', type: 'varchar', length: '64' },
          { name: 'entityId', type: 'varchar', length: '128' },
          { name: 'before', type: 'jsonb', isNullable: true },
          { name: 'after', type: 'jsonb', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
        checks: [
          new TableCheck({
            name: 'CHK_audit_trails_action',
            expression:
              `"action" IN ('insert', 'update', 'delete')`,
          }),
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'audit_trails',
      new TableIndex({
        name: 'IDX_audit_trails_entity_time',
        columnNames: ['entityType', 'entityId', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'audit_trails',
      new TableIndex({
        name: 'IDX_audit_trails_actor_time',
        columnNames: ['actorId', 'createdAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_trails', true);
  }
}
