import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

/**
 * Builds TypeORM connection options from validated configuration. Entities are
 * auto-loaded via the `autoLoadEntities` flag so feature modules only need to
 * register their entities with `TypeOrmModule.forFeature`.
 *
 * Includes connection pool tuning, SSL, and structured logging for production
 * observability.
 */
@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.configService.get('database');
    const logger = new Logger('DatabaseConfig');

    const options: TypeOrmModuleOptions = {
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.name,
      autoLoadEntities: true,
      synchronize: db.synchronize,
      logging: db.logging ? ['query', 'error', 'schema', 'migration'] : false,
      extra: {
        ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
        max: db.poolMax,
        min: db.poolMin,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      },
    };

    if (db.synchronize) {
      logger.warn(
        'Database synchronize is enabled. This should NEVER be used in production.',
      );
    }

    return options;
  }
}
