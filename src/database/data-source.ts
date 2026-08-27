import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

// The Nest app itself gets its config through `@nestjs/config` (see
// `src/config`), which is wired into dependency injection and isn't
// available to a plain CLI script. The TypeORM CLI (`typeorm-ts-node-commonjs`,
// invoked via the `migration:*` npm scripts) needs a standalone
// `DataSource`, so this file loads `.env` itself and duplicates only the
// connection settings — not the full validated config — that migrations
// need.
dotenv.config();

/**
 * Pool sizing mirrors `src/config/database.config.ts` so a migration run
 * behaves like the app it is migrating for; see docs/database.md.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Never use `synchronize` on this DataSource: it exists to generate and
  // run migrations, and synchronize + migrations together is how schemas
  // drift silently.
  synchronize: false,
  entities: [
    __dirname + '/../modules/**/*.entity{.ts,.js}',
    __dirname + '/../../libs/common/src/**/*.entity{.ts,.js}',
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  extra: {
    max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
    min: parseInt(process.env.DB_POOL_MIN ?? '5', 10),
    idleTimeoutMillis: parseInt(
      process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000',
      10,
    ),
    connectionTimeoutMillis: parseInt(
      process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '5000',
      10,
    ),
  },
};

const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
