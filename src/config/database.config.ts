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
    };
  }
}
