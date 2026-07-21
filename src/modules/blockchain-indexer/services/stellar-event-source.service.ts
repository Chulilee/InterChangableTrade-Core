import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import { BlockchainEvent, BlockchainEventType } from '../entities/blockchain-event.entity';

interface RawTransaction {
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_charged: string;
  successful: boolean;
  transaction_type: string;
  paging_token: string;
}

interface RawOperation {
  id: string;
  transaction_hash: string;
  application_index: number;
  type: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  amount?: string;
  path?: Array<{ asset_code?: string; asset_issuer?: string }>;
  price?: string;
  offer_id?: number;
}

@Injectable()
export class StellarEventSourceService {
  private readonly logger = new Logger(StellarEventSourceService.name);
  private readonly server: Horizon.Server;
  private readonly pollIntervalMs: number;
  private readonly pageLimit: number;
  private readonly includeFailed: boolean;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.get<string>('stellar.horizonUrl') ??
      'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(horizonUrl);
    this.pollIntervalMs =
      this.configService.get<number>('blockchainIndexer.pollIntervalMs') ??
      2000;
    this.pageLimit =
      this.configService.get<number>('blockchainIndexer.pageLimit') ?? 200;
    this.includeFailed =
      this.configService.get<boolean>('blockchainIndexer.includeFailed') ??
      true;
  }

  async getLatestLedgerSequence(): Promise<number> {
    try {
      const ledger = await this.server.ledgers().order('desc').limit(1).call();
      return ledger.records[0].sequence;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to fetch latest ledger: ${(error as Error).message}`,
      );
    }
  }

  async getTransactionsSinceCursor(
    cursor: string,
    limit = 200,
  ): Promise<RawTransaction[]> {
    try {
      const result = await this.server
        .transactions()
        .cursor(cursor)
        .order('asc')
        .limit(limit)
        .includeFailed(this.includeFailed)
        .call();
      return result.records;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to fetch transactions: ${(error as Error).message}`,
      );
    }
  }

  async getOperationsForTransaction(
    txHash: string,
  ): Promise<RawOperation[]> {
    try {
      const result = await this.server
        .operations()
        .forTransaction(txHash)
        .limit(200)
        .call();
      return result.records;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to fetch operations for ${txHash}: ${(error as Error).message}`,
      );
    }
  }

  async getTransactionByHash(
    txHash: string,
  ): Promise<RawTransaction | null> {
    try {
      const result = await this.server
        .transactions()
        .transaction(txHash)
        .call();
      return result.records[0] ?? null;
    } catch {
      return null;
    }
  }

  async getTransactionsByLedgerRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<RawTransaction[]> {
    const results: RawTransaction[] = [];
    for (let ledger = fromLedger; ledger <= toLedger; ledger++) {
      try {
        const page = await this.server
          .transactions()
          .ledger(ledger)
          .limit(this.pageLimit)
          .includeFailed(this.includeFailed)
          .call();
        results.push(...page.records);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch transactions for ledger ${ledger}: ${(error as Error).message}`,
        );
      }
    }
    return results;
  }

  async getOperationsInLedgerRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<RawOperation[]> {
    const results: RawOperation[] = [];
    for (let ledger = fromLedger; ledger <= toLedger; ledger++) {
      try {
        const page = await this.server
          .operations()
          .ledger(ledger)
          .limit(this.pageLimit)
          .call();
        results.push(...page.records);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch operations for ledger ${ledger}: ${(error as Error).message}`,
        );
      }
    }
    return results;
  }

  getPollIntervalMs(): number {
    return this.pollIntervalMs;
  }

  getPageLimit(): number {
    return this.pageLimit;
  }
}
