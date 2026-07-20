import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  Networks,
  rpc,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import {
  SorobanNetworkError,
  SorobanContractError,
  SorobanApplicationError,
  classifySdkError,
} from './soroban.errors';
import { SorobanNetworkStatus } from './soroban.types';

/**
 * Thin, injectable wrapper around the Stellar SDK's Soroban RPC `Server`.
 *
 * Every other service in the module talks to the chain through this one place,
 * which keeps network configuration, the optional server signer, and error
 * classification centralized. It deliberately owns no business logic — it just
 * exposes the RPC surface the higher-level services need, wrapping raw SDK
 * failures into the module's typed error hierarchy.
 */
@Injectable()
export class SorobanClientService {
  private readonly logger = new Logger(SorobanClientService.name);
  private readonly server: rpc.Server;
  private readonly rpcUrl: string;
  private readonly passphrase: string;
  private readonly network: string;
  private readonly sourceKeypair: Keypair | null;

  constructor(private readonly configService: ConfigService) {
    this.rpcUrl = this.configService.get<string>('stellar.sorobanRpcUrl')!;
    this.passphrase =
      this.configService.get<string>('stellar.networkPassphrase') ??
      Networks.TESTNET;
    this.network =
      this.configService.get<string>('stellar.network') ?? 'testnet';

    const allowHttp =
      this.configService.get<boolean>('soroban.allowHttp') ?? false;
    this.server = new rpc.Server(this.rpcUrl, { allowHttp });

    const secret = this.configService.get<string>('soroban.sourceSecret');
    this.sourceKeypair = secret ? Keypair.fromSecret(secret) : null;
    if (!this.sourceKeypair) {
      this.logger.warn(
        'No SOROBAN_SOURCE_SECRET configured; write invocations and deployments are disabled (read-only mode).',
      );
    }
  }

  /** The underlying RPC server. Prefer the helpers below where they exist. */
  getServer(): rpc.Server {
    return this.server;
  }

  getNetworkPassphrase(): string {
    return this.passphrase;
  }

  /**
   * Returns the configured server signer, throwing an ApplicationError if none
   * is set. Write paths call this so the "read-only mode" failure is explicit
   * and consistent rather than a null dereference.
   */
  requireSigner(): Keypair {
    if (!this.sourceKeypair) {
      throw new SorobanApplicationError(
        'This operation requires a server signer, but SOROBAN_SOURCE_SECRET is not configured.',
      );
    }
    return this.sourceKeypair;
  }

  hasSigner(): boolean {
    return this.sourceKeypair !== null;
  }

  /**
   * Loads an account for transaction building. Wraps RPC failures via the
   * shared classifier so callers get consistent network/contract typing.
   */
  async getAccount(publicKey: string) {
    try {
      return await this.server.getAccount(publicKey);
    } catch (error) {
      throw classifySdkError(error);
    }
  }

  /** Health + latest-ledger snapshot for observability and readiness checks. */
  async getNetworkStatus(): Promise<SorobanNetworkStatus> {
    const status: SorobanNetworkStatus = {
      rpcUrl: this.rpcUrl,
      passphrase: this.passphrase,
      network: this.network,
      healthy: false,
    };

    try {
      const health = await this.server.getHealth();
      status.healthy = health.status === 'healthy';
      const ledger = await this.server.getLatestLedger();
      status.latestLedger = ledger.sequence;
      status.protocolVersion = Number(ledger.protocolVersion);
    } catch (error) {
      // Health check failures are reported as unhealthy rather than thrown, so
      // a status endpoint can surface degraded state without erroring.
      this.logger.warn(
        `Soroban RPC health check failed: ${(error as Error).message}`,
      );
    }

    return status;
  }

  /** Current ledger sequence — used by the event indexer as a poll cursor. */
  async getLatestLedgerSequence(): Promise<number> {
    try {
      const ledger = await this.server.getLatestLedger();
      return ledger.sequence;
    } catch (error) {
      throw new SorobanNetworkError(
        `Failed to fetch latest ledger: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }

  /**
   * Simulates a transaction, translating an error-status simulation into a
   * typed application error. Success/restore responses are returned as-is for
   * the caller to inspect (gas, return value, footprint).
   */
  async simulate(
    tx: Transaction,
  ): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    let sim: rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.server.simulateTransaction(tx);
    } catch (error) {
      throw classifySdkError(error);
    }
    if (rpc.Api.isSimulationError(sim)) {
      throw new SorobanApplicationError(`Simulation failed: ${sim.error}`);
    }
    // A restore response also carries the success fields we need; both satisfy
    // SimulateTransactionSuccessResponse.
    return sim as rpc.Api.SimulateTransactionSuccessResponse;
  }

  /**
   * Assembles (prepares) a transaction against a simulation so it carries the
   * correct Soroban resource footprint and fees, ready to sign.
   */
  async prepareTransaction(tx: Transaction): Promise<Transaction> {
    try {
      return await this.server.prepareTransaction(tx);
    } catch (error) {
      throw classifySdkError(error);
    }
  }

  /**
   * Submits a signed transaction and polls until it settles or times out.
   * Returns the final successful `getTransaction` response, or throws a typed
   * error describing why it failed.
   */
  async sendAndConfirm(
    tx: Transaction | FeeBumpTransaction,
  ): Promise<ConfirmedTransaction> {
    const pollIntervalMs =
      this.configService.get<number>('soroban.pollIntervalMs') ?? 1000;
    const pollTimeoutMs =
      this.configService.get<number>('soroban.pollTimeoutMs') ?? 30000;

    let sendResponse: rpc.Api.SendTransactionResponse;
    try {
      sendResponse = await this.server.sendTransaction(tx);
    } catch (error) {
      throw classifySdkError(error);
    }

    if (sendResponse.status === 'ERROR') {
      throw new SorobanContractError('Transaction rejected on submission', {
        diagnostics: this.extractDiagnostics(sendResponse),
      });
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + pollTimeoutMs;

    // Poll until the transaction leaves the NOT_FOUND (in-mempool) state.
    while (Date.now() < deadline) {
      let getResponse: rpc.Api.GetTransactionResponse;
      try {
        getResponse = await this.server.getTransaction(hash);
      } catch (error) {
        throw classifySdkError(error);
      }

      if (getResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { ...getResponse, txHash: hash };
      }

      if (getResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new SorobanContractError(`Transaction ${hash} failed on-chain`, {
          diagnostics: [JSON.stringify(getResponse.resultXdr ?? '')],
        });
      }

      await this.sleep(pollIntervalMs);
    }

    throw new SorobanNetworkError(
      `Transaction ${hash} did not confirm within ${pollTimeoutMs}ms`,
    );
  }

  private extractDiagnostics(
    response: rpc.Api.SendTransactionResponse,
  ): string[] {
    const diagnostics: string[] = [];
    if (response.errorResult) {
      diagnostics.push(response.errorResult.result().switch().name);
    }
    return diagnostics;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * A confirmed transaction: the successful `getTransaction` response plus the
 * submission hash (which the response itself does not carry).
 */
export type ConfirmedTransaction = rpc.Api.GetSuccessfulTransactionResponse & {
  txHash: string;
};
