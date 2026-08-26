import { DataSource, EntityManager } from 'typeorm';
import { TransactionHelper } from '@app/common';

/**
 * Verifies the helper delegates to `DataSource.transaction` with the supplied
 * isolation level and that failures propagate (after TypeORM's rollback).
 */
describe('TransactionHelper', () => {
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    dataSource = { transaction: jest.fn() };
  });

  it('runs work inside a transaction with the requested isolation level', async () => {
    dataSource.transaction.mockImplementation(
      async (
        isolation: string | undefined,
        work: (m: EntityManager) => Promise<unknown>,
      ) => work({} as EntityManager),
    );

    const helper = new TransactionHelper(dataSource as unknown as DataSource);
    const outcome = await helper.run(async (tx) => `done:${!!tx}`, 'SERIALIZABLE');

    expect(dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(outcome).toBe('done:true');
  });

  it('propagates errors thrown by the work unit', async () => {
    dataSource.transaction.mockImplementation(
      async (_isolation: string | undefined, work: () => Promise<unknown>) =>
        work(),
    );

    const helper = new TransactionHelper(dataSource as unknown as DataSource);
    await expect(
      helper.run(async () => {
        throw new Error('constraint violated');
      }),
    ).rejects.toThrow('constraint violated');
  });

  it('joins an existing manager without opening a nested transaction', async () => {
    const manager = {} as EntityManager;
    const probe = jest.fn().mockResolvedValue(42);

    const result = await TransactionHelper.join(manager, probe);

    expect(result).toBe(42);
    expect(probe).toHaveBeenCalledWith(manager);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
