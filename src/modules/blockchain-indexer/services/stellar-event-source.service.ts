import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon } from '@stellar/stellar-sdk';

export interface RawTransaction {
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_charged: string;
  successful: boolean;
  transaction_type?: string;
  paging_token: string;
}

export interface RawOperation {
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
  starting_balance?: string;
  into?: string;
}

@Injectable()
export class StellarEventSourceService {
  private readonly logger = new Logger(StellarEventSourceService.name);
  private readonly server: Horizon.Server;
  private readonly horizonUrl: string;
  private readonly pollIntervalMs: number;
  private readonly pageLimit: number;
  private readonly includeFailed: boolean;

  constructor(private readonly configService: ConfigService) {
    this.horizonUrl =
      this.configService.get<string>('stellar.horizonUrl') ??
      'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(this.horizonUrl);
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
      const builder = this.server
        .transactions()
        .cursor(cursor)
        .order('asc')
        .limit(limit);

      if (this.includeFailed) {
        (builder as any).includeFailed?.(true);
      }

      const result = await builder.call();
      return result.records.map((tx: any) => ({
        hash: tx.hash,
        ledger: tx.ledger,
        created_at: tx.created_at,
        source_account: tx.source_account,
        fee_charged: tx.fee_charged,
        successful: tx.successful,
        transaction_type: tx.transaction_type,
        paging_token: tx.paging_token,
      }));
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to fetch transactions: ${(error as Error).message}`,
      );
    }
  }

  async getOperationsForTransaction(txHash: string): Promise<RawOperation[]> {
    try {
      const result = await this.server
        .operations()
        .forTransaction(txHash)
        .limit(200)
        .call();
      return result.records.map((op: any) => ({
        transaction_hash: op.transaction_hash,
        application_index: op.application_index,
        type: op.type,
        asset_code: op.asset_code,
        asset_issuer: op.asset_issuer,
        from: op.from,
        to: op.to,
        amount: op.amount,
        path: op.path,
        price: op.price,
        offer_id: op.offer_id,
        starting_balance: op.starting_balance,
        into: op.into,
      }));
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to fetch operations for ${txHash}: ${(error as Error).message}`,
      );
    }
  }

  async getTransactionByHash(txHash: string): Promise<RawTransaction | null> {
    try {
      const url = `${this.horizonUrl}/transactions/${txHash}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      const tx = data._embedded?.records?.[0] ?? data;
      if (!tx?.hash) return null;
      return {
        hash: tx.hash,
        ledger: tx.ledger,
        created_at: tx.created_at,
        source_account: tx.source_account,
        fee_charged: tx.fee_charged,
        successful: tx.successful,
        paging_token: tx.paging_token,
      };
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
        const url = `${this.horizonUrl}/transactions?ledger=${ledger}&limit=200`;
        const response = await fetch(url);
        if (!response.ok) continue;
        const data = await response.json();
        const records = data._embedded?.records ?? [];
        results.push(
          ...records.map((tx: any) => ({
            hash: tx.hash,
            ledger: tx.ledger,
            created_at: tx.created_at,
            source_account: tx.source_account,
            fee_charged: tx.fee_charged,
            successful: tx.successful,
            paging_token: tx.paging_token,
          })),
        );
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
        const url = `${this.horizonUrl}/operations?ledger=${ledger}&limit=200`;
        const response = await fetch(url);
        if (!response.ok) continue;
        const data = await response.json();
        const records = data._embedded?.records ?? [];
        results.push(
          ...records.map((op: any) => ({
            transaction_hash: op.transaction_hash,
            type: op.type,
            asset_code: op.asset_code,
            asset_issuer: op.asset_issuer,
            from: op.from,
            to: op.to,
            amount: op.amount,
            path: op.path,
            price: op.price,
            offer_id: op.offer_id,
          })),
        );
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
