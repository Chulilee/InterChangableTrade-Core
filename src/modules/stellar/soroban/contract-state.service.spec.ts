import { rpc } from '@stellar/stellar-sdk';
import { ContractStateService } from './contract-state.service';

/** Minimal in-memory stand-in for the subset of ioredis we use. */
class FakeRedis {
  private store = new Map<string, string>();

  async get(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async set(key: string, value: string) {
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async scan(_cursor: string, _match: string, pattern: string) {
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix));
    return ['0', keys];
  }
  size() {
    return this.store.size;
  }
}

describe('ContractStateService', () => {
  const CONTRACT = 'CABC';
  let redis: FakeRedis;
  let client: { getServer: jest.Mock };
  let getContractData: jest.Mock;
  let service: ContractStateService;

  const makeEntry = (value: number) => ({
    val: {
      contractData: () => ({ val: () => ({ __native: value }) }),
    },
    lastModifiedLedgerSeq: 100,
    liveUntilLedgerSeq: 200,
  });

  beforeEach(() => {
    redis = new FakeRedis();
    getContractData = jest.fn().mockResolvedValue(makeEntry(42));
    client = { getServer: jest.fn(() => ({ getContractData })) };

    // scValToNative is mocked at the module boundary below.
    const config = { get: () => 30 };
    service = new ContractStateService(
      client as never,
      config as never,
      redis as never,
    );
  });

  it('fetches from the network on a cold read and caches the result', async () => {
    const first = await service.getState(CONTRACT, 'balance');
    expect(first.cached).toBe(false);
    expect(getContractData).toHaveBeenCalledTimes(1);
    expect(redis.size()).toBe(1);

    const second = await service.getState(CONTRACT, 'balance');
    expect(second.cached).toBe(true);
    // Still only one network call — the second read was served from cache.
    expect(getContractData).toHaveBeenCalledTimes(1);
    expect(second.value).toEqual(first.value);
  });

  it('bypasses the cache when forceRefresh is set', async () => {
    await service.getState(CONTRACT, 'balance');
    await service.getState(CONTRACT, 'balance', { forceRefresh: true });
    expect(getContractData).toHaveBeenCalledTimes(2);
  });

  it('uses distinct cache keys per durability', async () => {
    await service.getState(CONTRACT, 'balance', {
      durability: rpc.Durability.Persistent,
    });
    await service.getState(CONTRACT, 'balance', {
      durability: rpc.Durability.Temporary,
    });
    expect(redis.size()).toBe(2);
    expect(getContractData).toHaveBeenCalledTimes(2);
  });

  it('invalidates a single cached key', async () => {
    await service.getState(CONTRACT, 'balance');
    await service.invalidate(CONTRACT, 'balance');
    await service.getState(CONTRACT, 'balance');
    expect(getContractData).toHaveBeenCalledTimes(2);
  });

  it('invalidates every entry for a contract', async () => {
    await service.getState(CONTRACT, 'a');
    await service.getState(CONTRACT, 'b');
    expect(redis.size()).toBe(2);
    const removed = await service.invalidateContract(CONTRACT);
    expect(removed).toBe(2);
    expect(redis.size()).toBe(0);
  });

  it('wraps network failures via the error classifier', async () => {
    getContractData.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.getState(CONTRACT, 'balance')).rejects.toMatchObject({
      category: 'network',
    });
  });

  describe('listStorageKeys', () => {
    it('returns the actual storage key rather than durability (fixes off-by-one index)', async () => {
      await service.getState(CONTRACT, 'admin_address', {
        durability: rpc.Durability.Persistent,
      });
      await service.getState(CONTRACT, 'fee_rate', {
        durability: rpc.Durability.Temporary,
      });

      const keys = await service.listStorageKeys(CONTRACT);
      expect(keys).toContain('admin_address');
      expect(keys).toContain('fee_rate');
      // Must NOT contain durability names like 'persistent' or 'temporary'
      expect(keys).not.toContain(rpc.Durability.Persistent);
      expect(keys).not.toContain(rpc.Durability.Temporary);
    });

    it('correctly handles storage keys containing colons', async () => {
      const complexKey = 'user:account:12345';
      await service.getState(CONTRACT, complexKey, {
        durability: rpc.Durability.Persistent,
      });

      const keys = await service.listStorageKeys(CONTRACT);
      expect(keys).toContain('user:account:12345');
    });

    it('falls back to full key when key format does not match expected prefix segments', async () => {
      await redis.set('custom:key:short', 'val');
      // If a non-conforming key matches scan pattern
      const scanMock = jest
        .spyOn(redis, 'scan')
        .mockResolvedValueOnce(['0', ['custom:short']]);
      const keys = await service.listStorageKeys(CONTRACT);
      expect(keys).toContain('custom:short');
      scanMock.mockRestore();
    });
  });

  describe('exportContractState', () => {
    it('exports all cached state key-value entries for the contract', async () => {
      getContractData.mockImplementation(async (_contract, key) => {
        const keyStr = typeof key === 'string' ? key : 'val';
        return makeEntry(keyStr === 'k1' ? 100 : 200);
      });

      await service.getState(CONTRACT, 'k1');
      await service.getState(CONTRACT, 'k2');

      const exported = await service.exportContractState(CONTRACT);
      expect(exported).toHaveProperty('k1');
      expect(exported).toHaveProperty('k2');
    });

    it('logs warning and continues export when an individual key read fails', async () => {
      await service.getState(CONTRACT, 'good_key');
      // Inject key that will fail on read
      await redis.set(
        `soroban:state:${CONTRACT}:persistent:bad_key`,
        'corrupt',
      );

      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      getContractData.mockRejectedValueOnce(
        new Error('Contract data not found'),
      );

      const exported = await service.exportContractState(CONTRACT);
      expect(warnSpy).toHaveBeenCalled();
      expect(exported).toHaveProperty('good_key');
      expect(exported).not.toHaveProperty('bad_key');
    });
  });
});

// scValToNative just needs to unwrap our fake ScVal for these tests.
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    scValToNative: (v: { __native: unknown }) => v.__native,
  };
});
