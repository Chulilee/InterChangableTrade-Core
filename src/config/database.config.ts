import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

/**
 * Builds TypeORM connection options from validated configuration. Entities are
 * auto-loaded via the `autoLoadEntities` flag so feature modules only need to
 * register their entities with `TypeOrmModule.forFeature`.
 */
@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.configService.get('database');
    return {
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.name,
      autoLoadEntities: true,
      synchronize: db.synchronize,
      logging: db.logging,
      // Version-controlled migrations (see src/database). Never run
      // automatically on boot — CI/CD applies them explicitly with
      // `npm run migration:run` before the new app version starts serving
      // traffic, so a bad migration fails the deploy rather than the app.
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      migrationsRun: false,
      // Connection pool (forwarded to node-postgres' `pg.Pool`). Reusing
      // warm connections instead of opening one per request is the single
      // biggest lever on request latency under load.
      extra: {
        max: db.pool.max,
        min: db.pool.min,
        idleTimeoutMillis: db.pool.idleTimeoutMs,
        connectionTimeoutMillis: db.pool.connectionTimeoutMs,
      },
    };
  }
}
