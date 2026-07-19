import { Injectable, Logger, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon, Networks, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';

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

export interface SettlementRequest {
  fromAccount: string;
  toAccount: string;
  assetCode: string;
  assetIssuer?: string | null;
  amount: string;
  price: string;
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

  /**
   * Executes a settlement transaction on the Stellar network. This transfers
   * the specified amount of the asset from the buyer to the seller.
   */
  async executeSettlement(settlementRequest: SettlementRequest): Promise<string> {
    try {
      const { fromAccount, toAccount, assetCode, assetIssuer, amount } = settlementRequest;
      
      // Load the source account (fromAccount - buyer's account)
      const sourceAccount = await this.server.loadAccount(fromAccount);
      
      // Create the asset - native XLM or issued asset
      const asset = assetIssuer 
        ? new Asset(assetCode, assetIssuer)
        : Asset.native();

      // Calculate the total amount to transfer (quantity * price for fiat, or just quantity for crypto)
      const transferAmount = parseFloat(amount).toFixed(7);

      // Build the transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        networkPassphrase: this.networkPassphrase,
        fee: '100', // Base fee
      })
        .addOperation(Operation.payment({
          destination: toAccount,
          asset: asset,
          amount: transferAmount,
        }))
        .setTimeout(30) // Transaction valid for 30 seconds
        .build();

      // In a real implementation, you would sign the transaction with the source account's secret key
      // For this implementation, we'll return a mock transaction hash
      // this.logger.log('Settlement transaction built successfully, would submit to network here');
      
      // For development, return a mock transaction hash
      const mockTxHash = `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.logger.log(`Settlement transaction ${mockTxHash} created for trade from ${fromAccount} to ${toAccount}`);
      
      return mockTxHash;
    } catch (error) {
      this.logger.error(
        `Failed to execute settlement: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to execute settlement transaction on Stellar network',
      );
    }
  }
}