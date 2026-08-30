import { ConfigService } from '@nestjs/config';
import { DatabaseConfig } from './database.config';

describe('DatabaseConfig', () => {
  const database = {
    host: 'db.internal',
    port: 5432,
    username: 'app',
    password: 'secret',
    name: 'app_db',
    synchronize: false,
    logging: true,
    pool: {
      max: 20,
      min: 5,
      idleTimeoutMs: 30000,
      connectionTimeoutMs: 5000,
    },
  };

  function build(): ReturnType<DatabaseConfig['createTypeOrmOptions']> {
    const configService = {
      get: jest.fn().mockReturnValue(database),
    } as unknown as ConfigService;
    return new DatabaseConfig(configService).createTypeOrmOptions();
  }

  it('maps validated config to postgres connection options', () => {
    const options = build() as Record<string, unknown>;

    expect(options.type).toBe('postgres');
    expect(options.host).toBe('db.internal');
    expect(options.port).toBe(5432);
    expect(options.username).toBe('app');
    expect(options.password).toBe('secret');
    expect(options.database).toBe('app_db');
    expect(options.autoLoadEntities).toBe(true);
    expect(options.synchronize).toBe(false);
  });

  it('forwards pool sizing to the pg driver via `extra`', () => {
    const options = build() as Record<string, any>;

    expect(options.extra).toEqual({
      max: 20,
      min: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  });

  it('points at the version-controlled migrations directory and never auto-runs them', () => {
    const options = build() as Record<string, any>;

    expect(options.migrationsRun).toBe(false);
    expect(Array.isArray(options.migrations)).toBe(true);
    expect(options.migrations[0]).toEqual(
      expect.stringContaining('database/migrations'),
    );
  });
});
