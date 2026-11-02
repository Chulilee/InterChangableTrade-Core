import { CredentialCleanupService } from './credential-cleanup.service';

function createDeleteBuilder(affected: number) {
  const builder: any = {
    delete: jest.fn(() => builder),
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    orWhere: jest.fn(() => builder),
    execute: jest.fn(async () => ({ affected })),
  };
  return builder;
}

function buildService(options: {
  refreshAffected?: number;
  resetAffected?: number;
  challengeAffected?: number;
  intervalMs?: number;
}) {
  const refreshBuilder = createDeleteBuilder(options.refreshAffected ?? 0);
  const resetBuilder = createDeleteBuilder(options.resetAffected ?? 0);
  const challengeBuilder = createDeleteBuilder(options.challengeAffected ?? 0);

  const service = new CredentialCleanupService(
    { createQueryBuilder: jest.fn(() => refreshBuilder) } as never,
    { createQueryBuilder: jest.fn(() => resetBuilder) } as never,
    { createQueryBuilder: jest.fn(() => challengeBuilder) } as never,
    {
      get: jest.fn(() => options.intervalMs ?? 3_600_000),
    } as never,
  );

  return { service, refreshBuilder, resetBuilder, challengeBuilder };
}

describe('CredentialCleanupService (issue #81)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('deletes expired refresh tokens, reset tokens and Stellar challenges', async () => {
    const { service, refreshBuilder, resetBuilder, challengeBuilder } =
      buildService({
        refreshAffected: 3,
        resetAffected: 2,
        challengeAffected: 5,
      });

    const now = new Date('2026-01-01T00:00:00.000Z');
    const result = await service.cleanupExpiredCredentials(now);

    expect(result).toEqual({
      refreshTokens: 3,
      passwordResetTokens: 2,
      stellarChallenges: 5,
    });

    expect(refreshBuilder.where).toHaveBeenCalledWith('"expiresAt" <= :now', {
      now,
    });
    expect(refreshBuilder.orWhere).toHaveBeenCalledWith(
      '"isRevoked" = true AND "revokedAt" <= :revokedCutoff',
      {
        revokedCutoff: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
    );

    expect(resetBuilder.where).toHaveBeenCalledWith('"expiresAt" <= :now', {
      now,
    });
    expect(resetBuilder.orWhere).toHaveBeenCalledWith('"isUsed" = true');

    expect(challengeBuilder.where).toHaveBeenCalledWith('"expiresAt" <= :now', {
      now,
    });
    expect(challengeBuilder.orWhere).toHaveBeenCalledWith('"isUsed" = true');
  });

  it('reports zero when the driver returns no affected-row count', async () => {
    const refreshBuilder = createDeleteBuilder(0);
    refreshBuilder.execute.mockResolvedValueOnce({ affected: null });

    const service = new CredentialCleanupService(
      { createQueryBuilder: jest.fn(() => refreshBuilder) } as never,
      { createQueryBuilder: jest.fn(() => createDeleteBuilder(0)) } as never,
      { createQueryBuilder: jest.fn(() => createDeleteBuilder(0)) } as never,
      { get: jest.fn(() => 3_600_000) } as never,
    );

    await expect(service.cleanupExpiredCredentials()).resolves.toEqual({
      refreshTokens: 0,
      passwordResetTokens: 0,
      stellarChallenges: 0,
    });
  });

  it('starts a periodic cleanup timer and clears it on shutdown', () => {
    jest.useFakeTimers();
    const { service } = buildService({ intervalMs: 60_000 });

    service.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
