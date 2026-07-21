import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
      await this.stateRepo.upsert(
        { key, value, updatedAt: new Date() },
        ['key'],
      );
    } catch (error) {
      this.logger.error(`Failed to persist state ${key}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Unable to persist indexing state');
    }
  }

  async getLastIndexedLedger(): Promise<number | null> {
    const value = await this.get('last_indexed_ledger');
    return value ? Number(value) : null;
  }

  async setLastIndexedLedger(ledger: number): Promise<void> {
    await this.set('last_indexed_ledger', String(ledger));
  }

  async getLastCursor(): Promise<string | null> {
    return this.get('last_cursor');
  }

  async setLastCursor(cursor: string): Promise<void> {
    await this.set('last_cursor', cursor);
  }
}
