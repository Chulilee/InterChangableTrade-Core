import * as bcrypt from 'bcryptjs';
import { ApiKeysService } from './api-keys.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async () => '$2a$10$stored-hash'),
  compare: jest.fn(async () => true),
}));

interface LookupRow {
  lookupHash?: string | null;
  [key: string]: any;
}

interface QueryState {
  lookupHash?: string;
  usedGetMany: boolean;
}

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

function seedKeys(count: number): LookupRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `key-${index}`,
    name: `key-${index}`,
    keyHash: `bcrypt-hash-${index}`,
    lookupHash: `digest:ict_unrelated-${index}`,
    isActive: true,
  }));
}

describe('ApiKeysService credential lookup (issue #81)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildService(rows: LookupRow[], state: QueryState) {
    const apiKeyRepo = {
      createQueryBuilder: jest.fn(() => createLookupQueryBuilder(rows, state)),
      update: jest.fn(async () => ({ affected: 1 })),
      findOne: jest.fn(async () => null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const tokenLookup = {
      digest: jest.fn((raw: string) => `digest:${raw}`),
    };
    const service = new ApiKeysService(
      apiKeyRepo as never,
      tokenLookup as never,
    );
    return { service, apiKeyRepo, tokenLookup };
  }

  it('performs exactly one bcrypt.compare with 1,000 active keys', async () => {
    const rows = seedKeys(1000);
    rows.push({
      id: 'key-target',
      name: 'production',
      keyHash: 'bcrypt-hash-target',
      lookupHash: 'digest:ict_valid-key',
      isActive: true,
      user: { id: 'user-1', isActive: true },
    });

    const state: QueryState = { usedGetMany: false };
    const { service, apiKeyRepo, tokenLookup } = buildService(rows, state);

    const result = await service.validate('ict_valid-key');

    expect(result.id).toBe('key-target');
    expect(tokenLookup.digest).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledWith(
      'ict_valid-key',
      'bcrypt-hash-target',
    );
    expect(state.usedGetMany).toBe(false);
    expect(apiKeyRepo.update).toHaveBeenCalledWith('key-target', {
      lastUsedAt: expect.any(Date),
    });
  });

  it('rejects an unknown key without running bcrypt.compare', async () => {
    const rows = seedKeys(1000);
    const state: QueryState = { usedGetMany: false };
    const { service } = buildService(rows, state);

    await expect(service.validate('ict_never-issued')).rejects.toThrow(
      'Invalid or expired API key',
    );

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(state.usedGetMany).toBe(false);
  });

  it('rejects a key with the wrong prefix before touching the database', async () => {
    const state: QueryState = { usedGetMany: false };
    const { service, apiKeyRepo } = buildService([], state);

    await expect(service.validate('sk_wrong-prefix')).rejects.toThrow(
      'Invalid API key format',
    );

    expect(apiKeyRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('does not accept a row when bcrypt rejects the key', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    const rows: LookupRow[] = [
      {
        id: 'key-1',
        keyHash: 'bcrypt-hash-1',
        lookupHash: 'digest:ict_collision',
        isActive: true,
      },
    ];
    const { service } = buildService(rows, { usedGetMany: false });

    await expect(service.validate('ict_collision')).rejects.toThrow(
      'Invalid or expired API key',
    );
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });

  it('persists a deterministic lookup hash at creation time', async () => {
    const { service, apiKeyRepo, tokenLookup } = buildService([], {
      usedGetMany: false,
    });

    const { plainKey } = await service.create('user-1', {
      name: 'ci',
    } as never);

    expect(tokenLookup.digest).toHaveBeenCalledWith(plainKey);
    expect(apiKeyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: 'ci',
        keyHash: '$2a$10$stored-hash',
        lookupHash: `digest:${plainKey}`,
      }),
    );
  });
});
