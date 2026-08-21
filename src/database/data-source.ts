import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CreateAuditTrailTable1724000000000 } from './migrations/1724000000000-CreateAuditTrailTable';

/**
 * Standalone TypeORM data source used by the migration CLI
 * (`npm run migration:run` etc.). It mirrors the runtime options from
 * `src/config/database.config.ts` but always runs against PostgreSQL with
 * explicit migrations instead of `synchronize`.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  migrations: [CreateAuditTrailTable1724000000000],
  logging: process.env.DB_LOGGING === 'true',
});
