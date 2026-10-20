import { ContractEventIndexerService } from './contract-event-indexer.service';

/** In-memory ioredis stand-in covering the string + sorted-set ops we use. */
class FakeRedis {
  private strings = new Map<string, string>();
  private zsets = new Map<string, Map<string, number>>();

  async set(
    key: string,
    value: string,
    _ex: string,
    _ttl: number,
    nx?: string,
  ) {
    if (nx === 'NX' && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async mget(...keys: string[]) {
    return keys.map((k) => this.strings.get(k) ?? null);
  }
  async zadd(key: string, score: number, member: string) {
    const z = this.zsets.get(key) ?? new Map<string, number>();
    z.set(member, score);
    this.zsets.set(key, z);
    return 1;
  }
  async expire() {
    return 1;
  }
  async zrevrangebyscore(
    key: string,
    _max: string,
    min: string | number,
    _limit: string,
    offset: number,
    count: number,
  ) {
    const z = this.zsets.get(key);
    if (!z) return [];
    const minScore = min === '-inf' ? -Infinity : Number(min);
    return [...z.entries()]
      .filter(([, score]) => score >= minScore)
      .sort((a, b) => b[1] - a[1])
      .slice(offset, offset + count)
      .map(([member]) => member);
  }
}

describe('ContractEventIndexerService', () => {
  const CONTRACT = 'CEVT';
  let redis: FakeRedis;
  let getEvents: jest.Mock;
  let client: any;
  let service: ContractEventIndexerService;

  const rawEvent = (id: string, ledger: number) => ({
    id,
    contractId: { contractId: () => CONTRACT },
    type: 'contract',
    ledger,
    ledgerClosedAt: '2025-01-01T00:00:00Z',
    topic: [{ __native: 'transfer' }],
    value: { __native: 100 },
    txHash: `tx-${id}`,
    pagingToken: id,
  });

  beforeEach(() => {
    redis = new FakeRedis();
    getEvents = jest.fn();
    client = {
      getLatestLedgerSequence: jest.fn().mockResolvedValue(1000),
      getServer: jest.fn(() => ({ getEvents })),
    };
    const config = { get: (k: string) => (k.includes('Poll') ? 500 : 86400) };
    service = new ContractEventIndexerService(
      client as never,
      config as never,
      redis as never,
    );
  });

  afterEach(() => service.stop());

  it('indexes events and returns them newest-first', async () => {
    getEvents.mockResolvedValue({
      events: [rawEvent('a', 1000), rawEvent('b', 1001)],
      latestLedger: 1001,
    });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll();

    const events = await service.getEvents(CONTRACT);
    expect(events.map((e) => e.id)).toEqual(['b', 'a']);
    expect(events[0]).toMatchObject({
      contractId: CONTRACT,
      topics: ['transfer'],
      value: 100,
      txHash: 'tx-b',
    });
  });

  it('does not duplicate an event replayed across poll cycles', async () => {
    getEvents.mockResolvedValue({
      events: [rawEvent('a', 1000)],
      latestLedger: 1000,
    });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll();
    // Replay the same event (e.g. cursor rewound after a restart).
    await (service as any).poll();

    const events = await service.getEvents(CONTRACT);
    expect(events).toHaveLength(1);
  });

  it('filters query results by fromLedger', async () => {
    getEvents.mockResolvedValue({
      events: [rawEvent('a', 1000), rawEvent('b', 1005)],
      latestLedger: 1005,
    });
    await service.watch(CONTRACT, 1000);
    await (service as any).poll();

    const recent = await service.getEvents(CONTRACT, { fromLedger: 1001 });
    expect(recent.map((e) => e.id)).toEqual(['b']);
  });

  it('survives a poll failure and retries on the next cycle', async () => {
    getEvents
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        events: [rawEvent('a', 1000)],
        latestLedger: 1000,
      });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll(); // fails, swallowed
    await (service as any).poll(); // succeeds

    const events = await service.getEvents(CONTRACT);
    expect(events).toHaveLength(1);
  });

  it('follows the cursor across multiple pages and indexes every event once', async () => {
    getEvents
      .mockResolvedValueOnce({
        events: [rawEvent('a', 1000), rawEvent('b', 1000)],
        latestLedger: 1000,
        cursor: 'page-1',
      })
      .mockResolvedValueOnce({
        events: [rawEvent('c', 1001)],
        latestLedger: 1001,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        events: [rawEvent('d', 1002)],
        latestLedger: 1002,
      });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll();

    const events = await service.getEvents(CONTRACT);
    expect(events.map((e) => e.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(getEvents).toHaveBeenCalledTimes(3);
  });

  it('does not lose events when a full page is followed by a non-null cursor', async () => {
    // Force the page limit low so two events fill a page.
    (service as any).pageLimit = 2;
    getEvents
      .mockResolvedValueOnce({
        events: [rawEvent('a', 1000), rawEvent('b', 1000)],
        latestLedger: 1000,
        cursor: 'more',
      })
      .mockResolvedValueOnce({
        events: [rawEvent('c', 1000)],
        latestLedger: 1000,
      });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll();

    const events = await service.getEvents(CONTRACT);
    expect(events.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('logs a warning when a full page has more pages pending', async () => {
    (service as any).pageLimit = 2;
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();
    getEvents
      .mockResolvedValueOnce({
        events: [rawEvent('a', 1000), rawEvent('b', 1000)],
        latestLedger: 1000,
        cursor: 'more',
      })
      .mockResolvedValueOnce({
        events: [rawEvent('c', 1000)],
        latestLedger: 1000,
      });

    await service.watch(CONTRACT, 1000);
    await (service as any).poll();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('silent event loss'),
    );
  });

  it('keeps per-contract cursors independent', async () => {
    const OTHER = 'COTHER';
    getEvents.mockImplementation((_request: unknown) => {
      const contract = (_request as any).filters[0].contractIds[0];
      return Promise.resolve({
        events: [rawEvent(`e-${contract}`, 1000)],
        latestLedger: 1000,
      });
    });

    await service.watch(CONTRACT, 1000);
    await service.watch(OTHER, 2000);
    await (service as any).poll();

    const cursors = (service as any).nextStartLedgerByContract as Map<
      string,
      number
    >;
    expect(cursors.get(CONTRACT)).toBe(1001);
    expect(cursors.get(OTHER)).toBe(1001);
  });
});

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    scValToNative: (v: { __native: unknown }) => v.__native,
  };
});
