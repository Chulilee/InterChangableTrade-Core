import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon, Networks } from '@stellar/stellar-sdk';

export interface AccountBalance {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  balance: string;
}

export interface AccountSummary {
  accountId: string;
  sequence: string;
  balances: AccountBalance[];
}

/**
 * Thin wrapper over the Stellar SDK's Horizon client. Centralizes network
 * configuration so the rest of the app talks to Stellar through one place.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl = this.configService.get<string>('stellar.horizonUrl')!;
    this.networkPassphrase =
      this.configService.get<string>('stellar.networkPassphrase') ??
      Networks.TESTNET;
    this.server = new Horizon.Server(horizonUrl);
  }

  getNetworkInfo(): { network: string; passphrase: string; horizonUrl: string } {
    return {
      network: this.configService.get<string>('stellar.network') ?? 'testnet',
      passphrase: this.networkPassphrase,
      horizonUrl: this.configService.get<string>('stellar.horizonUrl')!,
    };
  }

  /**
   * Fetches an account's balances from Horizon. Wraps SDK/network errors in a
   * 503 so callers get a consistent, meaningful failure.
   */
  async getAccount(accountId: string): Promise<AccountSummary> {
    try {
      const account = await this.server.loadAccount(accountId);
      const balances: AccountBalance[] = account.balances.map((b) => ({
        assetType: b.asset_type,
        assetCode: 'asset_code' in b ? b.asset_code : undefined,
        assetIssuer: 'asset_issuer' in b ? b.asset_issuer : undefined,
        balance: b.balance,
      }));
      return {
        accountId: account.accountId(),
        sequence: account.sequenceNumber(),
        balances,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load account ${accountId}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to reach the Stellar network or account not found',
      );
    }
  }
}
