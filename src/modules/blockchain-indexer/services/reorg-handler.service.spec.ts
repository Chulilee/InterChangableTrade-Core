import { BlockchainEvent } from '../entities/blockchain-event.entity';
import { IndexedEvent } from '../entities/indexed-event.entity';
import { ReorgHandlerService } from './reorg-handler.service';

describe('ReorgHandlerService', () => {
  let indexedUpdate: jest.Mock;
  let legacyUpdate: jest.Mock;
  let transaction: jest.Mock;
  let state: {
    getLastIndexedLedger: jest.Mock;
    getLastIndexedLedgerHash: jest.Mock;
    setLastIndexedLedger: jest.Mock;
    getSequenceCounter: jest.Mock;
  };
  let eventSource: {
    getLatestLedgerSequence: jest.Mock;
    getLedger: jest.Mock;
    getTransactionsByLedgerRange: jest.Mock;
    getOperationsForTransaction: jest.Mock;
  };
  let normalizer: {
    getCurrentSequence: jest.Mock;
    initializeSequenceCounter: jest.Mock;
    normalizeStellarOperations: jest.Mock;
    assignSequence: jest.Mock;
  };
  let persistence: {
    enqueueBatch: jest.Mock;
    flush: jest.Mock;
  };

  function createService(maxBackfillLedgers = 1000): ReorgHandlerService {
    indexedUpdate = jest.fn().mockResolvedValue({ affected: 2 });
    legacyUpdate = jest.fn().mockResolvedValue({ affected: 3 });

    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === IndexedEvent) return { update: indexedUpdate };
        if (entity === BlockchainEvent) return { update: legacyUpdate };
        throw new Error('unexpected repository');
      }),
    };

    transaction = jest.fn(async (callback: (m: unknown) => unknown) =>
      callback(manager),
    );

    state = {
      getLastIndexedLedger: jest.fn().mockResolvedValue(100),
      getLastIndexedLedgerHash: jest.fn().mockResolvedValue('hash-100'),
      setLastIndexedLedger: jest.fn().mockResolvedValue(undefined),
      getSequenceCounter: jest.fn().mockResolvedValue(BigInt(0)),
    };

    eventSource = {
      getLatestLedgerSequence: jest.fn().mockResolvedValue(101),
      getLedger: jest.fn().mockImplementation(async (sequence: number) => ({
        sequence,
        hash: `hash-${sequence}`,
      })),
      getTransactionsByLedgerRange: jest.fn().mockResolvedValue([]),
      getOperationsForTransaction: jest.fn().mockResolvedValue([]),
    };

    normalizer = {
      getCurrentSequence: jest.fn().mockReturnValue(BigInt(0)),
      initializeSequenceCounter: jest.fn(),
      normalizeStellarOperations: jest.fn().mockReturnValue([]),
      assignSequence: jest.fn((event: unknown) => ({
        ...(event as object),
        sequenceNumber: '1',
      })),
    };

    persistence = {
      enqueueBatch: jest.fn(),
      flush: jest.fn().mockResolvedValue(1),
    };

    const config = {
      get: jest.fn().mockReturnValue(maxBackfillLedgers),
    } as any;

    return new ReorgHandlerService(
      { transaction } as any,
      state as any,
      eventSource as any,
      normalizer as any,
      persistence as any,
      config,
    );
  }

  it('is a no-op when the stored hash matches the on-chain hash', async () => {
    const service = createService();

    await expect(service.detectAndHandle()).resolves.toBe(false);

    expect(eventSource.getLedger).toHaveBeenCalledWith(100);
    expect(transaction).not.toHaveBeenCalled();
    expect(state.setLastIndexedLedger).not.toHaveBeenCalled();
    expect(persistence.enqueueBatch).not.toHaveBeenCalled();
  });

  it('invalidates IndexedEvent and BlockchainEvent on a hash mismatch', async () => {
    const service = createService();
    eventSource.getLatestLedgerSequence.mockResolvedValue(101);
    eventSource.getLedger.mockImplementation(async (sequence: number) => ({
      sequence,
      hash: sequence === 100 ? 'replacement-hash' : `hash-${sequence}`,
    }));
    eventSource.getTransactionsByLedgerRange.mockResolvedValue([
      {
        hash: 'tx-1',
        ledger: 100,
        created_at: new Date().toISOString(),
        source_account: 'GABC',
        fee_charged: '100',
        successful: true,
        paging_token: '100_1',
      },
    ]);
    normalizer.normalizeStellarOperations.mockReturnValue([
      { ledgerSequence: 100 },
    ]);

    await expect(service.detectAndHandle()).resolves.toBe(true);

    expect(indexedUpdate).toHaveBeenCalledTimes(1);
    expect(legacyUpdate).toHaveBeenCalledTimes(1);
    expect(persistence.enqueueBatch).toHaveBeenCalledTimes(1);
    expect(persistence.flush).toHaveBeenCalledTimes(1);

    // Rewind first, then advance to the re-indexed ledger.
    expect(state.setLastIndexedLedger).toHaveBeenNthCalledWith(1, 99, null);
    expect(state.setLastIndexedLedger).toHaveBeenLastCalledWith(
      101,
      'hash-101',
    );
    expect(service.getStats().reorgCount).toBe(1);
  });

  it('treats a ledger that Horizon no longer knows as a reorg', async () => {
    const service = createService();
    eventSource.getLedger.mockResolvedValue(null);

    await expect(service.detectAndHandle()).resolves.toBe(true);

    expect(indexedUpdate).toHaveBeenCalledTimes(1);
    expect(state.setLastIndexedLedger).toHaveBeenCalled();
  });

  it('backfills a large gap and advances the cursor', async () => {
    const service = createService(1000);
    eventSource.getLatestLedgerSequence.mockResolvedValue(2101);
    eventSource.getTransactionsByLedgerRange.mockResolvedValue([]);
    eventSource.getLedger.mockImplementation(async (sequence: number) => ({
      sequence,
      hash: `hash-${sequence}`,
    }));

    await expect(service.detectAndHandle()).resolves.toBe(false);

    expect(eventSource.getTransactionsByLedgerRange).toHaveBeenCalledWith(
      101,
      1100,
    );
    expect(state.setLastIndexedLedger).toHaveBeenCalledWith(1100, 'hash-1100');
    expect(service.getStats().reorgCount).toBe(0);
  });

  it('skips hash comparison when no hash has been persisted yet', async () => {
    const service = createService();
    state.getLastIndexedLedgerHash.mockResolvedValue(null);
    eventSource.getLatestLedgerSequence.mockResolvedValue(101);

    await expect(service.detectAndHandle()).resolves.toBe(false);

    expect(eventSource.getLedger).not.toHaveBeenCalled();
  });
});
