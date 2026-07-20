import { Injectable } from '@nestjs/common';

export const DATABASE_CONSTANTS = {
  DEFAULT_POOL_MAX: 20,
  DEFAULT_POOL_MIN: 5,
  DEFAULT_POOL_IDLE_TIMEOUT: 30000,
  DEFAULT_POOL_CONNECTION_TIMEOUT: 5000,
  DEFAULT_MIGRATIONS_DIR: 'src/migrations',
  DEFAULT_BACKUP_INTERVAL_MIN: 60,
  DEFAULT_BACKUP_RETENTION_DAYS: 7,
  DEFAULT_SHARD_COUNT: 1,
  MAX_QUERY_RESULT_SIZE: 1000,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  AUDIT_TABLE_NAME: 'audit_trails',
} as const;

@Injectable()
export class DatabaseConstantsService {
  getConstants() {
    return DATABASE_CONSTANTS;
  }
}
