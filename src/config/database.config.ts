import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { AuditTrailSubscriber } from '../database/audit-trail.subscriber';

/**
 * Builds TypeORM connection options from validated configuration. Entities are
 * auto-loaded via the `autoLoadEntities` flag so feature modules only need to
 * register their entities with `TypeOrmModule.forFeature`.
 *
 * Pool sizing is environment-driven (`DB_POOL_MAX` / `DB_POOL_MIN`) — pg
 * exposes these as poolSize/min. Versioned migrations are wired via
 * `DB_MIGRATIONS_RUN`; prefer them over `synchronize` outside development.
 */
@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly auditTrailSubscriber: AuditTrailSubscriber,
  ) {}

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

      // Connection pooling.
      poolSize: db.poolMax,
      extra: {
        min: db.poolMin,
        max: db.poolMax,
        // Recycle connections so they do not outlive DB/network idle timeouts.
        idleTimeoutMillis: db.poolIdleTimeoutMs,
      },

      // Row-level change capture (see src/database/audit-trail.subscriber.ts).
      subscribers: [this.auditTrailSubscriber],

      // Versioned migrations infrastructure (see src/database/migrations/).
      migrationsRun: db.migrationsRun,
    };
  }
}
