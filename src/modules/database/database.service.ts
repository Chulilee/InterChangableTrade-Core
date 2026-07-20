import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

export interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  connectionCount: number;
  idleCount: number;
  waitingCount: number;
  checks: {
    connection: boolean;
    migration: boolean;
    replication: boolean;
  };
}

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly dataSource: DataSource) {}

  async healthCheck(): Promise<DatabaseHealth> {
    const start = Date.now();
    const checks = {
      connection: false,
      migration: false,
      replication: false,
    };

    try {
      await this.dataSource.query('SELECT 1');
      checks.connection = true;
    } catch (error) {
      this.logger.error('Database connection health check failed', error);
    }

    try {
      const result = await this.dataSource.query(
        'SELECT COUNT(*) as count FROM typeorm_migrations',
      );
      checks.migration = true;
    } catch (error) {
      this.logger.warn('Migration table check failed', error);
    }

    try {
      await this.dataSource.query('SELECT pg_is_in_recovery()');
      checks.replication = !!(await this.dataSource.query('SELECT pg_is_in_recovery()'));
    } catch (error) {
      this.logger.warn('Replication check failed', error);
    }

    const latencyMs = Date.now() - start;
    const pool = this.dataSource.driver.options.extra as any;

    const allHealthy = checks.connection && checks.migration;
    const status = allHealthy
      ? checks.replication
        ? 'healthy'
        : 'degraded'
      : 'unhealthy';

    return {
      status,
      latencyMs,
      connectionCount: pool?.totalCount ?? 0,
      idleCount: pool?.idleCount ?? 0,
      waitingCount: pool?.waitingCount ?? 0,
      checks,
    };
  }

  async dropAndRecreate(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot drop database in production');
    }

    await this.dataSource.dropDatabase();
    await this.dataSource.synchronize();
    this.logger.warn('Database dropped and recreated');
  }

  async getQueryRunner(transaction = false): Promise<QueryRunner> {
    return transaction
      ? this.dataSource.createQueryRunner()
      : this.dataSource.createQueryRunner();
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }
}
