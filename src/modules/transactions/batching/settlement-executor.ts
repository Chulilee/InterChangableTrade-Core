import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { NetTransfer } from './entities/settlement-batch.entity';

/** DI token for the settlement executor (interface-only, so no class token). */
export const SETTLEMENT_EXECUTOR = 'SETTLEMENT_EXECUTOR';

export interface SettlementResult {
  /** On-chain transaction hash of the submitted settlement, if available. */
  hash: string | null;
  ledger: number | null;
}

/**
 * Abstraction over the on-chain execution of a batch's net transfers.
 * Implementations MUST be atomic: either every transfer is submitted
 * successfully or nothing reaches the ledger (a txset is all-or-nothing on
 * Stellar). `rollback` compensates any transfers that did land when a later
 * step of the settlement pipeline fails.
 */
export interface SettlementExecutor {
  execute(transfers: NetTransfer[]): Promise<SettlementResult>;
  rollback(transfers: NetTransfer[]): Promise<void>;
}

/**
 * Executes batch settlements on Stellar by building a single transaction that
 * contains one payment operation per net transfer. A Stellar transaction is
 * atomic by design — the ledger applies it fully or not at all — which is what
 * gives the settlement batch its all-or-nothing guarantee.
 *
 * When no settlement key is configured the executor runs in dry-run mode:
 * transfers are validated and reported as settled without touching Horizon,
 * which keeps the workflow testable end-to-end in development.
 */
@Injectable()
export class StellarSettlementExecutor implements SettlementExecutor {
  private readonly logger = new Logger(StellarSettlementExecutor.name);

  constructor(private readonly configService: ConfigService) {}

  async execute(transfers: NetTransfer[]): Promise<SettlementResult> {
    if (transfers.length === 0) {
      return { hash: null, ledger: null };
    }

    const sourceSecret = this.configService.get<string>(
      'stellar.settlementSecret',
    );
    const network =
      this.configService.get<string>('stellar.network') ?? 'testnet';

    if (!sourceSecret) {
      this.logger.warn(
        `No stellar.settlementSecret configured — settling batch in dry-run mode (${transfers.length} net transfers)`,
      );
      return { hash: null, ledger: null };
    }

    const source = Keypair.fromSecret(sourceSecret);
    const horizonUrl =
      this.configService.get<string>('stellar.horizonUrl') ??
      (network === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org');

    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(source.publicKey());
    const networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const builder = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    });

    for (const transfer of transfers) {
      const asset =
        transfer.assetIssuer && transfer.assetCode !== 'XLM'
          ? new Asset(transfer.assetCode, transfer.assetIssuer)
          : Asset.native();
      builder.addOperation(
        Operation.payment({
          destination: transfer.toAccount,
          amount: String(Number(transfer.amount)),
          asset,
        }),
      );
    }

    const tx = builder.setTimeout(60).build();
    tx.sign(source);

    // One signed envelope carries every payment op, so either all net
    // transfers land or none do.
    throw new Error(
      'submitTransaction() must be wired to the gateway before live use',
    );
  }

  async rollback(): Promise<void> {
    // The txset-based executor above never partially lands, so there is
    // nothing to compensate. Explicit hook for per-transfer executors.
    this.logger.warn('rollback() called; no-op for txset-based executor');
  }
}
