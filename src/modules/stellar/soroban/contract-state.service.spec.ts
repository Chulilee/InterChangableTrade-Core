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
});

// scValToNative just needs to unwrap our fake ScVal for these tests.
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    scValToNative: (v: { __native: unknown }) => v.__native,
  };
});
