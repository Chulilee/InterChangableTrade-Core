import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

export interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async executeInTransaction<T>(
    callback: (queryRunner: QueryRunner) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const {
      isolationLevel = 'READ COMMITTED',
      timeout = 30000,
      retryAttempts = 3,
      retryDelay = 1000,
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      const queryRunner = this.dataSource.createQueryRunner();
      let committed = false;

      try {
        await queryRunner.connect();
        await queryRunner.startTransaction(isolationLevel);

        const result = await callback(queryRunner);

        await queryRunner.commitTransaction();
        committed = true;

        return result;
      } catch (error) {
        this.logger.error(
          `Transaction attempt ${attempt}/${retryAttempts} failed`,
          error,
        );

        if (!queryRunner.isTransactionActive) {
          throw error;
        }

        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {
          this.logger.error('Transaction rollback failed', rollbackError);
        }

        lastError = error as Error;

        if (attempt < retryAttempts) {
          await this.delay(retryDelay * attempt);
        }
      } finally {
        await queryRunner.release();
      }
    }

    throw lastError ?? new Error('Transaction failed after all retry attempts');
  }

  async executeReadOnly<T>(
    callback: (queryRunner: QueryRunner) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return this.executeInTransaction(callback, {
      ...options,
      isolationLevel: 'READ UNCOMMITTED',
      retryAttempts: 1,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
