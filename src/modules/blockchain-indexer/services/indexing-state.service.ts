import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IndexerState } from '../entities/indexer-state.entity';

@Injectable()
export class IndexingStateService {
  private readonly logger = new Logger(IndexingStateService.name);

  constructor(
    @InjectRepository(IndexerState)
    private readonly stateRepo: Repository<IndexerState>,
  ) {}

  async get(key: string): Promise<string | null> {
    const record = await this.stateRepo.findOne({ where: { key } });
    return record?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.stateRepo.upsert({ key, value, updatedAt: new Date() }, [
        'key',
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to persist state ${key}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Unable to persist indexing state');
    }
  }

  async getLastIndexedLedger(): Promise<number | null> {
    const value = await this.get('last_indexed_ledger');
    return value ? Number(value) : null;
  }

  async setLastIndexedLedger(
    ledger: number,
    ledgerHash: string | null = null,
  ): Promise<void> {
    try {
      await this.stateRepo.upsert(
        {
          key: 'last_indexed_ledger',
          value: String(ledger),
          ledgerHash,
          updatedAt: new Date(),
        },
        ['key'],
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist state last_indexed_ledger: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Unable to persist indexing state');
    }
  }

  /**
   * Hash of the ledger recorded by {@link setLastIndexedLedger}. Returns null
   * when no hash has been stored yet (for example after an upgrade, or after a
   * reorg rewind), in which case hash-based reorg detection is skipped until
   * the next ledger close records a fresh hash.
   */
  async getLastIndexedLedgerHash(): Promise<string | null> {
    const record = await this.stateRepo.findOne({
      where: { key: 'last_indexed_ledger' },
    });
    return record?.ledgerHash ?? null;
  }

  async getLastCursor(): Promise<string | null> {
    return this.get('last_cursor');
  }

  async setLastCursor(cursor: string): Promise<void> {
    await this.set('last_cursor', cursor);
  }

  async getLedgerCursor(): Promise<string | null> {
    return this.get('stream_ledger_cursor');
  }

  async setLedgerCursor(sequence: string): Promise<void> {
    await this.set('stream_ledger_cursor', sequence);
  }

  async getLastLedgerCursor(): Promise<string | null> {
    return this.get('stream_ledger_cursor');
  }

  /**
   * Horizon paging token of the last ledger stream message that was fully
   * indexed. Unlike a ledger sequence, a paging token is the only value
   * Horizon's `cursor` parameter accepts when resuming a stream.
   */
  async getLedgerPagingToken(): Promise<string | null> {
    return this.getLedgerCursor();
  }

  async setLedgerPagingToken(token: string): Promise<void> {
    await this.setLedgerCursor(token);
  }

  async getSequenceCounter(): Promise<bigint> {
    const value = await this.get('sequence_counter');
    return value ? BigInt(value) : BigInt(0);
  }

  async setSequenceCounter(counter: bigint): Promise<void> {
    await this.set('sequence_counter', counter.toString());
  }
}
