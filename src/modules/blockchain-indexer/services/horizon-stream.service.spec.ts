import { HorizonStreamService } from './horizon-stream.service';

/** Captured shape of a Horizon `/ledgers` streaming record. */
const LEDGER_FIXTURE = {
  _links: {
    self: { href: 'https://horizon.test/ledgers/12345' },
  },
  id: 'abc123def456',
  paging_token: '12345',
  hash: 'abc123def456',
  prev_hash: 'prev-hash',
  sequence: 12345,
  successful_transaction_count: 3,
  failed_transaction_count: 0,
  closed_at: '2026-01-01T00:00:00Z',
};

function sseFrame(record: Record<string, unknown>): string {
  return `event: ledgers\ndata: ${JSON.stringify(record)}\n\n`;
}

/**
 * Builds a fake streaming Response. When `end` is false the reader's promise
 * never settles, emulating an open stream.
 */
function streamResponse(chunks: string[], end = true) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            return { done: false, value: encoder.encode(chunks[index++]) };
          }
          if (end) {
            return { done: true, value: undefined };
          }
          return new Promise(() => undefined);
        },
      }),
    },
  };
}

const openStream = () => streamResponse([], false);

describe('HorizonStreamService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let state: {
    getLedgerPagingToken: jest.Mock;
    getLastIndexedLedger: jest.Mock;
    setLedgerPagingToken: jest.Mock;
  };

  function createService(baseMs = 1000, maxMs = 30000): HorizonStreamService {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'stellar.horizonUrl') return 'https://horizon.test';
        if (key === 'blockchainIndexer.wsReconnectBaseDelayMs') return baseMs;
        if (key === 'blockchainIndexer.wsReconnectMaxDelayMs') return maxMs;
        return undefined;
      }),
    } as any;

    state = {
      getLedgerPagingToken: jest.fn().mockResolvedValue(null),
      getLastIndexedLedger: jest.fn().mockResolvedValue(null),
      setLedgerPagingToken: jest.fn().mockResolvedValue(undefined),
    };

    return new HorizonStreamService(config, state as any);
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    jest.useRealTimers();
  });

  it('streams captured ledger records that processLine matches', async () => {
    fetchMock.mockResolvedValue(
      streamResponse([sseFrame(LEDGER_FIXTURE)], false),
    );

    const service = createService();
    const ledgerEvents: unknown[] = [];
    service.on('ledger', (event) => ledgerEvents.push(event));

    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/ledgers?order=asc&cursor=now&stream=true');

    expect(ledgerEvents).toHaveLength(1);
    expect(ledgerEvents[0]).toMatchObject({
      sequence: 12345,
      hash: 'abc123def456',
      pagingToken: '12345',
      closedAt: '2026-01-01T00:00:00Z',
    });
    expect(service.getLastLedgerSequence()).toBe(12345);
    expect(service.getLatestLedgerSequence()).toBe(12345);
    expect(service.getLastCursor()).toBe('12345');

    service.stop();
  });

  it('resumes from the persisted paging token, not a ledger sequence', async () => {
    fetchMock.mockResolvedValue(openStream());

    const service = createService();
    state.getLedgerPagingToken.mockResolvedValue('98765');

    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('cursor=98765');
    expect(url).toContain('stream=true');

    service.stop();
  });

  it('schedules a reconnect when the stream ends normally', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(streamResponse([sseFrame(LEDGER_FIXTURE)], true))
      .mockResolvedValueOnce(openStream());

    const service = createService(1000, 30000);
    const health: Array<{ status: string }> = [];
    service.on('health', (event) => health.push(event));

    await service.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(health).toContainEqual(
      expect.objectContaining({ status: 'reconnecting' }),
    );

    // Nothing happens inside the backoff window...
    await jest.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // ...and the reconnect fires at the boundary.
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.getStats()).toMatchObject({
      totalReconnects: 1,
      reconnectAttempts: 1,
    });

    service.stop();
  });

  it('schedules a reconnect when the transport throws', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(openStream());

    const service = createService(1000, 30000);
    const health: Array<{ status: string }> = [];
    service.on('health', (event) => health.push(event));

    await service.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(health).toContainEqual(expect.objectContaining({ status: 'error' }));

    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    service.stop();
  });

  it('honours the configured reconnect ceiling', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(streamResponse([], true))
      .mockResolvedValueOnce(streamResponse([], true))
      .mockResolvedValue(openStream());

    const service = createService(1000, 1500);

    await service.start();
    await jest.advanceTimersByTimeAsync(0);

    // First backoff: 1000ms.
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second backoff would be 2000ms, capped at 1500ms.
    await jest.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    service.stop();
  });

  it('does not reconnect after stop()', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValueOnce(streamResponse([], true));

    const service = createService(1000, 30000);

    await service.start();
    await jest.advanceTimersByTimeAsync(0);

    service.stop();
    await jest.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
