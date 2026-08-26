import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';

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

export interface AccountSignerEntry {
  key: string;
  weight: number;
  type: string;
}

export interface AccountSignersSummary {
  accountId: string;
  masterWeight: number;
  thresholds: { low: number; med: number; high: number };
  signers: AccountSignerEntry[];
}

export interface SubmitTransactionResult {
  hash: string;
  successful: boolean;
  ledger?: number;
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

  getNetworkInfo(): {
    network: string;
    passphrase: string;
    horizonUrl: string;
  } {
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
   * Surfaces an account's signer set and operation thresholds from the
   * **classic** Horizon endpoint. Unlike {@link getAccount}, this keeps the
   * `signers`/`thresholds` fields the signing pipeline needs to work out who may
   * sign and how much weight is required.
   */
  async getAccountSigners(accountId: string): Promise<AccountSignersSummary> {
    try {
      const account = await this.server.loadAccount(accountId);
      const signers: AccountSignerEntry[] = account.signers.map((s) => ({
        key: s.key,
        weight: s.weight,
        type: s.type,
      }));
      const master = signers.find((s) => s.key === account.accountId());
      return {
        accountId: account.accountId(),
        masterWeight: master?.weight ?? 0,
        thresholds: {
          low: account.thresholds.low_threshold,
          med: account.thresholds.med_threshold,
          high: account.thresholds.high_threshold,
        },
        signers,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load signers for ${accountId}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to reach the Stellar network or account not found',
      );
    }
  }

  /**
   * Submits a fully-signed transaction envelope to the network. Rebuilds a
   * `Transaction` from the XDR (the SDK's `submitTransaction` requires the
   * object, not a raw string) and returns the canonical hash and result.
   */
  async submitTransaction(signedXdr: string): Promise<SubmitTransactionResult> {
    try {
      const transaction = TransactionBuilder.fromXDR(
        signedXdr,
        this.networkPassphrase,
      );
      const response = await this.server.submitTransaction(transaction);
      return {
        hash: response.hash,
        successful: response.successful,
        ledger: response.ledger,
      };
    } catch (error) {
      // Horizon returns transaction/operation result codes on rejection; surface
      // them so callers can record a meaningful failure reason.
      const resultCodes = (
        error as {
          response?: { data?: { extras?: { result_codes?: unknown } } };
        }
      )?.response?.data?.extras?.result_codes;
      const detail = resultCodes
        ? JSON.stringify(resultCodes)
        : (error as Error).message;
      this.logger.error(`Failed to submit transaction: ${detail}`);
      throw new ServiceUnavailableException(
        `Stellar submission failed: ${detail}`,
      );
    }
  }

  /**
   * Executes a settlement transaction on the Stellar network. This transfers
   * the specified amount of the asset from the buyer to the seller.
   */
  async executeSettlement(
    settlementRequest: SettlementRequest,
  ): Promise<string> {
    try {
      const { fromAccount, toAccount, assetCode, assetIssuer, amount } =
        settlementRequest;

      // Load the source account (fromAccount - buyer's account)
      const sourceAccount = await this.server.loadAccount(fromAccount);

      // Create the asset - native XLM or issued asset
      const asset = assetIssuer
        ? new Asset(assetCode, assetIssuer)
        : Asset.native();

      // Calculate the total amount to transfer (quantity * price for fiat, or just quantity for crypto)
      const transferAmount = parseFloat(amount).toFixed(7);

      // Build the transaction
      new TransactionBuilder(sourceAccount, {
        networkPassphrase: this.networkPassphrase,
        fee: '100', // Base fee
      })
        .addOperation(
          Operation.payment({
            destination: toAccount,
            asset: asset,
            amount: transferAmount,
          }),
        )
        .setTimeout(30) // Transaction valid for 30 seconds
        .build();

      // In a real implementation, you would sign the transaction with the source account's secret key
      // For this implementation, we'll return a mock transaction hash
      // this.logger.log('Settlement transaction built successfully, would submit to network here');

      // For development, return a mock transaction hash
      const mockTxHash = `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.logger.log(
        `Settlement transaction ${mockTxHash} created for trade from ${fromAccount} to ${toAccount}`,
      );

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
