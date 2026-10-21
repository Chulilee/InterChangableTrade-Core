import { BatchedPersistenceService } from './batched-persistence.service';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeEvent(sequence: number) {
  return {
    sequenceNumber: String(sequence),
    ledgerSequence: 100,
    eventType: 'payment',
    transactionHash: `tx-${sequence}`,
    timestamp: new Date(),
    sourceAccount: 'GABC',
    invalidated: false,
  } as any;
}

describe('BatchedPersistenceService', () => {
  let setSequenceCounter: jest.Mock;
  let transaction: jest.Mock;
  let insertExecute: jest.Mock;
  let queryBuilder: Record<string, jest.Mock>;
  let stateService: {
    setSequenceCounter: jest.Mock;
    getSequenceCounter: jest.Mock;
  };

  function createService(): BatchedPersistenceService {
    setSequenceCounter = jest.fn().mockResolvedValue(undefined);
    stateService = {
      setSequenceCounter,
      getSequenceCounter: jest.fn().mockResolvedValue(BigInt(0)),
    };

    queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: insertExecute,
    };

    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    transaction = jest.fn(async (callback: (m: unknown) => unknown) =>
      callback(manager),
    );

    const dataSource = { transaction } as any;
    const config = { get: jest.fn().mockReturnValue(undefined) } as any;

    return new BatchedPersistenceService(
      {} as any,
      stateService as any,
      dataSource,
      config,
    );
  }

  beforeEach(() => {
    insertExecute = jest.fn().mockResolvedValue({ raw: [] });
  });

  it('does not advance the persisted counter when events are only enqueued', () => {
    const service = createService();

    service.enqueue(makeEvent(1));
    service.enqueue(makeEvent(2));

    expect(setSequenceCounter).not.toHaveBeenCalled();
    expect(service.getHighestPersistedSequence()).toBe(BigInt(0));
    expect(service.getStats().highestEnqueuedSequence).toBe(2);
  });

  it('persists the committed sequence only after the insert resolves', async () => {
    const pending = deferred<{ raw: unknown[] }>();
    insertExecute.mockReturnValueOnce(pending.promise);
    const service = createService();

    service.enqueue(makeEvent(1));
    service.enqueue(makeEvent(2));

    const flushing = service.flush();

    // Insert has been issued but not committed yet.
    expect(setSequenceCounter).not.toHaveBeenCalled();

    pending.resolve({
      raw: [{ sequenceNumber: '1' }, { sequenceNumber: '2' }],
    });
    await expect(flushing).resolves.toBe(2);

    expect(setSequenceCounter).toHaveBeenCalledTimes(1);
    expect(setSequenceCounter).toHaveBeenCalledWith(BigInt(2));
    expect(service.getHighestPersistedSequence()).toBe(BigInt(2));
  });

  it('replays events after a crash before the flush commits', async () => {
    const crashed = createService();
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)];

    for (const event of events) crashed.enqueue(event);

    // Simulate the process dying before flush: the persisted counter never
    // moved, so a restarted normalizer resumes from 0 and re-derives the same
    // events instead of skipping them.
    expect(setSequenceCounter).not.toHaveBeenCalled();
    expect(crashed.getHighestPersistedSequence()).toBe(BigInt(0));

    const restarted = createService();
    expect(restarted.getHighestPersistedSequence()).toBe(BigInt(0));

    insertExecute.mockResolvedValue({
      raw: events.map((event) => ({ sequenceNumber: event.sequenceNumber })),
    });
    for (const event of events) restarted.enqueue(event);

    await expect(restarted.flush()).resolves.toBe(3);
    expect(setSequenceCounter).toHaveBeenCalledWith(BigInt(3));
  });

  it('does not advance the counter when the insert fails, and requeues the batch', async () => {
    const service = createService();
    transaction.mockRejectedValueOnce(new Error('connection reset'));

    service.enqueue(makeEvent(1));
    service.enqueue(makeEvent(2));

    await expect(service.flush()).resolves.toBe(0);

    expect(setSequenceCounter).not.toHaveBeenCalled();
    expect(service.getStats().pendingCount).toBe(2);
    expect(service.getHighestPersistedSequence()).toBe(BigInt(0));
  });

  it('waits for an in-flight flush instead of returning 0', async () => {
    const first = deferred<{ raw: unknown[] }>();
    const second = deferred<{ raw: unknown[] }>();
    insertExecute
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const service = createService();
    service.enqueue(makeEvent(1));

    const firstFlush = service.flush();
    expect(transaction).toHaveBeenCalledTimes(1);

    service.enqueue(makeEvent(2));
    const secondFlush = service.flush();

    first.resolve({ raw: [{ sequenceNumber: '1' }] });
    // Allow the first drain loop to pick up the event enqueued mid-flight.
    await Promise.resolve();
    await Promise.resolve();
    second.resolve({ raw: [{ sequenceNumber: '2' }] });

    await expect(firstFlush).resolves.toBe(2);
    await expect(secondFlush).resolves.toBe(2);
    expect(setSequenceCounter).toHaveBeenCalledWith(BigInt(2));
  });

  it('awaits the final flush during module destroy', async () => {
    insertExecute.mockResolvedValue({
      raw: [{ sequenceNumber: '7' }],
    });
    const service = createService();

    service.enqueue(makeEvent(7));
    await service.onModuleDestroy();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(setSequenceCounter).toHaveBeenCalledWith(BigInt(7));
    expect(service.getStats().pendingCount).toBe(0);
  });

  it('counts and logs rows rejected by the unique sequence index', async () => {
    insertExecute.mockResolvedValue({
      raw: [{ sequenceNumber: '2' }],
    });
    const service = createService();

    service.enqueue(makeEvent(1));
    service.enqueue(makeEvent(2));

    await expect(service.flush()).resolves.toBe(1);

    expect(service.getStats().rejectedByUniqueConstraint).toBe(1);
    // The rejected sequence 2 was already committed, so the high-water mark
    // still advances to it.
    expect(setSequenceCounter).toHaveBeenCalledWith(BigInt(2));
  });
});
