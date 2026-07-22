import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Horizon,
} from '@stellar/stellar-sdk';
import {
  StellarConnectionPoolService,
  PooledConnection,
} from './stellar-connection-pool.service';
import { StellarRateLimiterService } from './stellar-rate-limiter.service';
import { StellarRequestQueueService } from './stellar-request-queue.service';

export interface GatewayRequest<T> {
  operation: string;
  clientId: string;
  payload: T;
  priority?: number;
}

export interface GatewayResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  latency: number;
  requestId: string;
  timestamp: Date;
}

export interface AccountSummary {
  accountId: string;
  sequence: string;
  balances: Array<{
    assetType: string;
    assetCode?: string;
    assetIssuer?: string;
    balance: string;
  }>;
}

export interface SettlementRequest {
  fromAccount: string;
  toAccount: string;
  assetCode: string;
  assetIssuer?: string | null;
  amount: string;
}

@Injectable()
export class StellarApiGatewayService {
  private readonly logger = new Logger(StellarApiGatewayService.name);
  private readonly networkPassphrase: string;
  private requestCounter: number = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly connectionPool: StellarConnectionPoolService,
    private readonly rateLimiter: StellarRateLimiterService,
    private readonly requestQueue: StellarRequestQueueService,
  ) {
    this.networkPassphrase =
      this.configService.get<string>('stellar.networkPassphrase') ??
      Networks.TESTNET;

    this.logger.log('Stellar API Gateway initialized successfully');
  }

  private generateRequestId(): string {
    return `stellar-gateway-${++this.requestCounter}-${Date.now()}`;
  }

  private async executeWithMonitoring<T>(
    requestId: string,
    clientId: string,
    operation: () => Promise<T>,
  ): Promise<GatewayResponse<T>> {
    const startTime = Date.now();

    try {
      this.rateLimiter.checkRateLimit(clientId);

      const queueStats = this.requestQueue.getQueueStats();
      this.rateLimiter.checkBurstLimit(queueStats.activeRequests);

      const result = await operation();

      const latency = Date.now() - startTime;
      this.logger.log(`Request ${requestId} completed in ${latency}ms`);

      return {
        success: true,
        data: result,
        latency,
        requestId,
        timestamp: new Date(),
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = (error as Error).message;

      this.logger.error(
        `Request ${requestId} failed after ${latency}ms: ${errorMessage}`,
      );

      return {
        success: false,
        error: errorMessage,
        latency,
        requestId,
        timestamp: new Date(),
      };
    }
  }

  async getAccount(
    accountId: string,
    clientId: string,
  ): Promise<GatewayResponse<AccountSummary>> {
    const requestId = this.generateRequestId();

    return this.requestQueue.enqueue(clientId, async () => {
      let connection: PooledConnection | null = null;

      try {
        connection = await this.connectionPool.acquireConnection();
        this.logger.debug(
          `Executing getAccount for ${accountId} with connection ${connection.id}`,
        );

        const account = await connection.server.loadAccount(accountId);
        this.connectionPool.releaseConnection(connection.id);

        const balances = account.balances.map((b) => ({
          assetType: b.asset_type,
          assetCode: 'asset_code' in b ? b.asset_code : undefined,
          assetIssuer: 'asset_issuer' in b ? b.asset_issuer : undefined,
          balance: b.balance,
        }));

        return this.executeWithMonitoring(requestId, clientId, async () => ({
          accountId: account.accountId(),
          sequence: account.sequenceNumber(),
          balances,
        }));
      } catch (error) {
        if (connection) {
          this.connectionPool.releaseConnection(connection.id);
        }
        throw error;
      }
    });
  }

  async executeSettlement(
    settlementRequest: SettlementRequest,
    clientId: string,
  ): Promise<GatewayResponse<string>> {
    const requestId = this.generateRequestId();

    return this.requestQueue.enqueue(clientId, async () => {
      let connection: PooledConnection | null = null;

      try {
        connection = await this.connectionPool.acquireConnection();
        this.logger.debug(
          `Executing settlement for ${settlementRequest.fromAccount} -> ${settlementRequest.toAccount} with connection ${connection.id}`,
        );

        const { fromAccount, toAccount, assetCode, assetIssuer, amount } =
          settlementRequest;

        const sourceAccount = await connection.server.loadAccount(fromAccount);

        const asset = assetIssuer
          ? new Asset(assetCode, assetIssuer)
          : Asset.native();

        const transferAmount = parseFloat(amount).toFixed(7);

        new TransactionBuilder(sourceAccount, {
          networkPassphrase: this.networkPassphrase,
          fee: '100',
        })
          .addOperation(
            Operation.payment({
              destination: toAccount,
              asset: asset,
              amount: transferAmount,
            }),
          )
          .setTimeout(30)
          .build();

        this.connectionPool.releaseConnection(connection.id);

        const mockTxHash = `settlement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.logger.log(
          `Settlement transaction ${mockTxHash} created for trade`,
        );

        return this.executeWithMonitoring(
          requestId,
          clientId,
          async () => mockTxHash,
        );
      } catch (error) {
        if (connection) {
          this.connectionPool.releaseConnection(connection.id);
        }
        throw error;
      }
    });
  }

  async getTransaction(
    transactionHash: string,
    clientId: string,
  ): Promise<GatewayResponse<Horizon.ServerApi.TransactionRecord>> {
    const requestId = this.generateRequestId();

    return this.requestQueue.enqueue(clientId, async () => {
      let connection: PooledConnection | null = null;

      try {
        connection = await this.connectionPool.acquireConnection();
        this.logger.debug(
          `Fetching transaction ${transactionHash} with connection ${connection.id}`,
        );

        const transaction = await connection.server
          .transactions()
          .transaction(transactionHash)
          .call();
        this.connectionPool.releaseConnection(connection.id);

        return this.executeWithMonitoring(
          requestId,
          clientId,
          async () => transaction,
        );
      } catch (error) {
        if (connection) {
          this.connectionPool.releaseConnection(connection.id);
        }
        throw error;
      }
    });
  }

  async submitTransaction(
    transactionXdr: string,
    clientId: string,
  ): Promise<GatewayResponse<any>> {
    const requestId = this.generateRequestId();

    return this.requestQueue.enqueue(clientId, async () => {
      let connection: PooledConnection | null = null;

      try {
        connection = await this.connectionPool.acquireConnection();
        this.logger.debug(
          `Submitting transaction with connection ${connection.id}`,
        );

        // In this Stellar SDK version, submitTransaction accepts XDR strings as well
        const result = await connection.server.submitTransaction(
          transactionXdr as any,
        );
        this.connectionPool.releaseConnection(connection.id);

        return this.executeWithMonitoring(
          requestId,
          clientId,
          async () => result,
        );
      } catch (error) {
        if (connection) {
          this.connectionPool.releaseConnection(connection.id);
        }
        throw error;
      }
    });
  }

  getGatewayStats() {
    return {
      pool: this.connectionPool.getPoolStats(),
      queue: this.requestQueue.getQueueStats(),
      rateLimit: this.rateLimiter.getRateLimitConfig(),
      totalProcessed: this.requestCounter,
      timestamp: new Date(),
    };
  }

  getNetworkInfo() {
    return {
      network: this.configService.get<string>('stellar.network') ?? 'testnet',
      passphrase: this.networkPassphrase,
      horizonUrl: this.configService.get<string>('stellar.horizonUrl')!,
    };
  }
}
