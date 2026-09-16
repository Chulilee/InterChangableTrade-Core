import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.module';

export type AppHealthStatus = 'ok' | 'degraded';

export type DependencyHealth = {
  status: 'up' | 'down';
  details?: string;
};

@Injectable()
export class AppService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  getInfo(): { name: string; status: string } {
    return {
      name: 'InterChangableTrade-Core',
      status: 'ok',
    };
  }

  async getHealth(): Promise<{
    status: AppHealthStatus;
    timestamp: string;
    database: DependencyHealth;
    redis: DependencyHealth;
  }> {
    const timestamp = new Date().toISOString();

    let databaseStatus: DependencyHealth = { status: 'down' };
    let redisStatus: DependencyHealth = { status: 'down' };

    try {
      await this.dataSource.query('SELECT 1');
      databaseStatus = { status: 'up' };
    } catch (error) {
      databaseStatus = {
        status: 'down',
        details: error instanceof Error ? error.message : 'Database check failed',
      };
    }

    try {
      await this.redisClient.ping();
      redisStatus = { status: 'up' };
    } catch (error) {
      redisStatus = {
        status: 'down',
        details: error instanceof Error ? error.message : 'Redis check failed',
      };
    }

    return {
      status: databaseStatus.status === 'up' && redisStatus.status === 'up' ? 'ok' : 'degraded',
      timestamp,
      database: databaseStatus,
      redis: redisStatus,
    };
  }
}
