import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => '$2a$10$hashed-token'),
  compare: jest.fn(async () => true),
}));

/**
 * Unit tests for the AuthService branching logic that can run without
 * PostgreSQL/Redis (the full-app integration suite lives in
 * auth.integration.spec.ts).
 */
describe('AuthService.requestPasswordReset', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock };
  let auditService: { recordSuccess: jest.Mock; recordFailure: jest.Mock };
  let resetTokenRepo: {
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let loggerWarn: jest.SpyInstance;
  let consoleLog: jest.SpyInstance;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    usersService = { findByEmail: jest.fn() };
    auditService = { recordSuccess: jest.fn(), recordFailure: jest.fn() };
    resetTokenRepo = {
      update: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async () => undefined),
    };

    service = new AuthService(
      usersService as never,
      { sign: jest.fn() } as unknown as JwtService,
      {
        get: jest.fn((key: string) =>
          key === 'env' ? process.env.NODE_ENV : undefined,
        ),
      } as unknown as ConfigService,
      auditService as never,
      {
        isLockedOut: jest.fn(async () => false),
        getLockoutTtl: jest.fn(async () => 60),
        clearFailures: jest.fn(),
        recordFailure: jest.fn(),
      } as never,
      {
        createChallenge: jest.fn(),
        verifyChallenge: jest.fn(),
      } as never,
      { digest: jest.fn((raw: string) => `digest:${raw}`) } as never,
      {} as never,
      resetTokenRepo as never,
    );

    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never writes the plaintext token to the logger or stdout in production', async () => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    usersService.findByEmail.mockResolvedValue({ id: 'user-1' });

    try {
      await service.requestPasswordReset('user@example.com', {});
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }

    expect(loggerWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('in non-production limits the token to the injected Logger (never console.log)', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'user-1' });

    await service.requestPasswordReset('user@example.com', {});

    // The token is only ever emitted through the structured Nest logger in
    // non-production environments, and never via console/stdout.
    expect(consoleLog).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(String(loggerWarn.mock.calls[0][0])).toContain(
      'Password reset token for user@example.com',
    );
  });

  it('returns an identical void result whether or not the email exists (no enumeration)', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(
      service.requestPasswordReset('nobody@example.com', {}),
    ).resolves.toBeUndefined();

    // Nothing is created or logged for a non-existent account.
    expect(resetTokenRepo.save).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();

    usersService.findByEmail.mockResolvedValue({ id: 'user-1' });
    await expect(
      service.requestPasswordReset('user@example.com', {}),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
//  O(1) credential lookup (issue #81)
// ---------------------------------------------------------------------------

interface LookupRow {
  lookupHash?: string | null;
  [key: string]: any;
}

interface QueryState {
  lookupHash?: string;
  usedGetMany: boolean;
}

/**
 * Minimal stand-in for TypeORM's query builder that behaves like the real
 * `SELECT ... WHERE lookupHash = $1`: it resolves the single row whose digest
 * matches and records whether the old full-table `getMany()` path was used.
 */
function createLookupQueryBuilder(rows: LookupRow[], state: QueryState): any {
  const record = (sql: string, params?: Record<string, any>) => {
    if (sql.includes('lookupHash') && params?.lookupHash !== undefined) {
      state.lookupHash = params.lookupHash;
    }
  };

  const builder: any = {
    addSelect: jest.fn(() => builder),
    leftJoinAndSelect: jest.fn(() => builder),
    where: jest.fn((sql: string, params?: Record<string, any>) => {
      record(sql, params);
      return builder;
    }),
    andWhere: jest.fn((sql: string, params?: Record<string, any>) => {
      record(sql, params);
      return builder;
    }),
    getOne: jest.fn(
      async () =>
        rows.find((row) => row.lookupHash === state.lookupHash) ?? null,
    ),
    getMany: jest.fn(async () => {
      state.usedGetMany = true;
      return rows;
    }),
  };

  return builder;
}

function buildService(overrides: {
  refreshTokenRepo?: any;
  resetTokenRepo?: any;
  usersService?: any;
}) {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'jwt.refreshExpiresIn') return '2592000';
      if (key === 'env') return 'test';
      return undefined;
    }),
  };
  const auditService = {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };
  const usersService = overrides.usersService ?? {
    updatePassword: jest.fn(),
  };

  const service = new AuthService(
    usersService,
    { sign: jest.fn(() => 'access-token') } as unknown as JwtService,
    configService as unknown as ConfigService,
    auditService as never,
    {
      isLockedOut: jest.fn(),
      getLockoutTtl: jest.fn(),
      clearFailures: jest.fn(),
      recordFailure: jest.fn(),
    } as never,
    {
      createChallenge: jest.fn(),
      verifyChallenge: jest.fn(),
    } as never,
    { digest: jest.fn((raw: string) => `digest:${raw}`) } as never,
    overrides.refreshTokenRepo ?? {},
    overrides.resetTokenRepo ?? {},
  );

  return { service, usersService, auditService };
}

function seedRows(prefix: string, count: number): LookupRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    userId: `user-${index}`,
    tokenHash: `bcrypt-hash-${index}`,
    lookupHash: `digest:unrelated-${prefix}-${index}`,
  }));
}

describe('AuthService credential lookup (issue #81)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('refreshAccessToken', () => {
    it('performs exactly one bcrypt.compare with 1,000 live sessions', async () => {
      const rows = seedRows('refresh', 1000);
      rows.push({
        id: 'rt-target',
        userId: 'user-target',
        tokenHash: 'bcrypt-hash-target',
        lookupHash: 'digest:raw-refresh-token',
        isRevoked: false,
        user: { id: 'user-target', email: 't@example.com', role: 'user' },
      });

      const state: QueryState = { usedGetMany: false };
      const refreshTokenRepo = {
        createQueryBuilder: jest.fn(() =>
          createLookupQueryBuilder(rows, state),
        ),
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      };

      const { service } = buildService({ refreshTokenRepo });

      const result = await service.refreshAccessToken('raw-refresh-token', {});

      expect(result.user.id).toBe('user-target');
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(state.usedGetMany).toBe(false);
      expect(refreshTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'rt-target', isRevoked: true }),
      );
    });

    it('rejects an unknown token without running bcrypt.compare', async () => {
      const rows = seedRows('refresh', 1000);
      const state: QueryState = { usedGetMany: false };
      const refreshTokenRepo = {
        createQueryBuilder: jest.fn(() =>
          createLookupQueryBuilder(rows, state),
        ),
      };

      const { service } = buildService({ refreshTokenRepo });

      await expect(
        service.refreshAccessToken('never-issued-token', {}),
      ).rejects.toThrow('Invalid or expired refresh token');
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('confirmPasswordReset', () => {
    it('performs exactly one bcrypt.compare with 1,000 pending reset tokens', async () => {
      const rows = seedRows('reset', 1000);
      rows.push({
        id: 'reset-target',
        userId: 'user-1',
        tokenHash: 'bcrypt-hash-target',
        lookupHash: 'digest:raw-reset-token',
        isUsed: false,
        user: { id: 'user-1' },
      });

      const state: QueryState = { usedGetMany: false };
      const resetTokenRepo = {
        createQueryBuilder: jest.fn(() =>
          createLookupQueryBuilder(rows, state),
        ),
        save: jest.fn(async (value) => value),
      };
      const refreshTokenRepo = { update: jest.fn() };
      const usersService = { updatePassword: jest.fn() };

      const { service } = buildService({
        resetTokenRepo,
        refreshTokenRepo,
        usersService,
      });

      await service.confirmPasswordReset('raw-reset-token', 'NewPass123!', {});

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(state.usedGetMany).toBe(false);
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
      );
    });

    it('rejects an unknown reset token without running bcrypt.compare', async () => {
      const rows = seedRows('reset', 1000);
      const state: QueryState = { usedGetMany: false };
      const resetTokenRepo = {
        createQueryBuilder: jest.fn(() =>
          createLookupQueryBuilder(rows, state),
        ),
      };

      const { service } = buildService({ resetTokenRepo });

      await expect(
        service.confirmPasswordReset('never-issued-token', 'NewPass123!', {}),
      ).rejects.toThrow('Invalid or expired reset token');
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('requestPasswordReset', () => {
    it('persists the deterministic lookup hash alongside the bcrypt hash', async () => {
      const resetTokenRepo = {
        update: jest.fn(),
        create: jest.fn((value) => value),
        save: jest.fn(async () => undefined),
      };
      const usersService = { findByEmail: jest.fn(async () => ({ id: 'u1' })) };

      const { service } = buildService({ resetTokenRepo, usersService });

      await service.requestPasswordReset('user@example.com', {});

      expect(resetTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          lookupHash: expect.stringMatching(/^digest:/),
        }),
      );
    });
  });
});
