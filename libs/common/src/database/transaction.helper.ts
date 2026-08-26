import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
} from 'typeorm';

/**
 * Isolation levels accepted by {@link DataSource.transaction} ("READ
 * UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE").
 */
export type TransactionIsolationLevel = Parameters<
  DataSource['transaction']
>[0];

/**
 * Thin ACID transaction helper. Wraps {@link DataSource.transaction} so
 * services get a scoped {@link EntityManager}: everything executed inside the
 * callback commits together or rolls back together.
 *
 * Usage:
 * ```ts
 * await this.transactions.run(async (tx) => {
 *   const wallet = await tx.findOneBy(Wallet, { id });
 *   wallet.balance -= amount;
 *   await tx.save(wallet);
 * }, 'SERIALIZABLE');
 * ```
 *
 * A thrown error propagates after TypeORM rolls back, so callers keep their
 * normal error handling. To compose code that must join an existing
 * transaction, pass its manager to {@link TransactionHelper.join}.
 */
@Injectable()
export class TransactionHelper {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    work: (manager: EntityManager) => Promise<T>,
    isolationLevel?: TransactionIsolationLevel,
  ): Promise<T> {
    return this.dataSource.transaction(isolationLevel as never, work);
  }

  /**
   * Runs work inside an existing transaction's manager. Useful for composing
   * repository helpers that must join a caller's transaction instead of
   * opening a nested one.
   */
  static join<T>(
    manager: EntityManager,
    work: (tx: EntityManager) => Promise<T>,
  ): Promise<T> {
    return work(manager);
  }
}
