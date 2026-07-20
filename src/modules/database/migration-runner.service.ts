import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface MigrationInfo {
  timestamp: number;
  name: string;
  executedAt?: Date;
}

export interface MigrationStatus {
  pending: MigrationInfo[];
  executed: MigrationInfo[];
  currentVersion: string | null;
}

@Injectable()
export class MigrationRunnerService {
  private readonly logger = new Logger(MigrationRunnerService.name);
  private readonly migrationsDir: string;

  constructor(private readonly dataSource: DataSource) {
    const dbConfig = this.dataSource.options as any;
    this.migrationsDir = dbConfig.migrationsDir || 'src/migrations';
  }

  async getStatus(): Promise<MigrationStatus> {
    try {
      const executedMigrations = await this.dataSource.query(
        'SELECT * FROM typeorm_migrations ORDER BY timestamp DESC',
      );

      const fsMigrations = this.loadMigrationFiles();

      const executedSet = new Set(
        executedMigrations.map((m: any) => m.name),
      );

      const pending = fsMigrations.filter(
        (m) => !executedSet.has(m.name),
      );

      const executed = fsMigrations
        .filter((m) => executedSet.has(m.name))
        .map((m) => {
          const exec = executedMigrations.find(
            (em: any) => em.name === m.name,
          );
          return {
            ...m,
            executedAt: exec?.executed_at ? new Date(exec.executed_at) : undefined,
          };
        });

      const currentVersion =
        executed.length > 0
          ? executed[0].name
          : null;

      return {
        pending,
        executed,
        currentVersion,
      };
    } catch (error) {
      this.logger.error('Failed to get migration status', error);
      return {
        pending: [],
        executed: [],
        currentVersion: null,
      };
    }
  }

  async runMigrations(): Promise<{ executed: number; failed: number }> {
    const status = await this.getStatus();

    if (status.pending.length === 0) {
      this.logger.log('No pending migrations');
      return { executed: 0, failed: 0 };
    }

    let executed = 0;
    let failed = 0;

    for (const migration of status.pending) {
      try {
        await this.dataSource.runMigrations({
          transaction: 'all',
        });
        this.logger.log(`Migration ${migration.name} executed successfully`);
        executed++;
      } catch (error) {
        this.logger.error(`Migration ${migration.name} failed`, error);
        failed++;
        break;
      }
    }

    return { executed, failed };
  }

  async rollbackMigration(steps = 1): Promise<{ rolledBack: number }> {
    const status = await this.getStatus();

    if (status.executed.length === 0) {
      return { rolledBack: 0 };
    }

    const toRollback = status.executed.slice(0, steps);
    let rolledBack = 0;

    for (const migration of toRollback) {
      try {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        await queryRunner.query(
          'DELETE FROM typeorm_migrations WHERE name = $1',
          [migration.name],
        );

        await queryRunner.commitTransaction();
        await queryRunner.release();

        this.logger.log(`Rolled back migration ${migration.name}`);
        rolledBack++;
      } catch (error) {
        this.logger.error(`Failed to rollback ${migration.name}`, error);
      }
    }

    return { rolledBack };
  }

  async generateMigration(name: string, outputDir?: string): Promise<string> {
    const timestamp = Date.now();
    const fileName = `${timestamp}-${name.replace(/\s+/g, '_').toLowerCase()}.ts`;
    const dir = outputDir || this.getAbsoluteMigrationsDir();

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const template = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${name.replace(/[^a-zA-Z0-9]/g, '')}${timestamp} implements MigrationInterface {
  name = '${fileName.replace('.ts', '')}';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add migration SQL here
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add rollback SQL here
  }
}
`;

    fs.writeFileSync(path.join(dir, fileName), template);
    this.logger.log(`Generated migration: ${fileName}`);

    return fileName;
  }

  private loadMigrationFiles(): MigrationInfo[] {
    const absDir = this.getAbsoluteMigrationsDir();

    if (!fs.existsSync(absDir)) {
      return [];
    }

    const files = fs.readdirSync(absDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => {
        const match = file.match(/^(\d+)-(.+)\.ts$/);
        if (!match) return null;
        return {
          timestamp: parseInt(match[1], 10),
          name: file,
        } as MigrationInfo;
      })
      .filter((m): m is MigrationInfo => m !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    return files;
  }

  private getAbsoluteMigrationsDir(): string {
    if (path.isAbsolute(this.migrationsDir)) {
      return this.migrationsDir;
    }

    const paths = [
      path.join(process.cwd(), this.migrationsDir),
      path.join(__dirname, '..', '..', '..', '..', this.migrationsDir),
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return paths[0];
  }
}
