import { EventIndexerService } from './event-indexer.service';

/**
 * Focused unit tests for `deduplicateAndPersist`.
 *
 * The production path relies on a unique index on `uniqueId` and
 * `INSERT ... ON CONFLICT DO NOTHING`; here we assert that the service uses
 * `orIgnore()` and only publishes events that were actually inserted.
 */
describe('EventIndexerService.deduplicateAndPersist', () => {
  const makeEvent = (uniqueId: string) =>
    ({
      uniqueId,
      eventType: 'payment',
      transactionHash: `tx-${uniqueId}`,
      ledger: 1000,
      timestamp: new Date(),
      sourceAccount: 'GSOURCE',
      destinationAccount: 'GDEST',
      assetCode: 'USDC',
      assetIssuer: null,
      amount: '100',
      raw: {},
      invalidated: false,
    }) as never;

  function buildService(rawResult: Array<{ uniqueId: string }>) {
    const execute = jest.fn().mockResolvedValue({ raw: rawResult });
    const qb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute,
    };
    const manager = { createQueryBuilder: jest.fn(() => qb) };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => Promise<void>) => cb(manager)),
    };
    const streamService = { publish: jest.fn().mockResolvedValue(undefined) };

    const service = new EventIndexerService(
      {} as never,
      {} as never,
      {} as never,
      streamService as never,
      dataSource as never,
    );

    return { service, qb, execute, streamService };
  }

  it('inserts with ON CONFLICT DO NOTHING and returns the inserted ids', async () => {
    const { service, qb, execute } = buildService([{ uniqueId: 'tx:0' }]);

    await (service as never as { deduplicateAndPersist(e: unknown[]): Promise<void> })
      .deduplicateAndPersist([makeEvent('tx:0')]);

    expect(qb.insert).toHaveBeenCalled();
    expect(qb.orIgnore).toHaveBeenCalled();
    expect(qb.returning).toHaveBeenCalledWith(['uniqueId']);
    expect(execute).toHaveBeenCalled();
  });

  it('only publishes events that were actually inserted', async () => {
    const { service, streamService } = buildService([{ uniqueId: 'tx:0' }]);

    await (service as never as { deduplicateAndPersist(e: unknown[]): Promise<void> })
      .deduplicateAndPersist([makeEvent('tx:0'), makeEvent('tx:1')]);

    expect(streamService.publish).toHaveBeenCalledTimes(1);
    expect(streamService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueId: 'tx:0' }),
    );
  });

  it('publishes nothing when every event already existed', async () => {
    const { service, streamService } = buildService([]);

    await (service as never as { deduplicateAndPersist(e: unknown[]): Promise<void> })
      .deduplicateAndPersist([makeEvent('tx:0')]);

    expect(streamService.publish).not.toHaveBeenCalled();
  });
});
