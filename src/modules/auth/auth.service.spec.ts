import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
        get: jest.fn(
          (key: string) => (key === 'env' ? process.env.NODE_ENV : undefined),
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
      {} as never,
      resetTokenRepo as never,
    );

    loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    consoleLog = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
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
