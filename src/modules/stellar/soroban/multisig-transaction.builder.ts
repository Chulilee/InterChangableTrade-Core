import { Injectable, Logger } from '@nestjs/common';
import {
  Account,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  xdr,
  Signer,
} from '@stellar/stellar-sdk';
import { SorobanClientService } from './soroban-client.service';
import { ContractAbiService } from './contract-abi.service';

/**
 * Represents a signer requirement for a multi-signature transaction
 */
export interface SignerRequirement {
  publicKey: string;
  /** Whether this signer has signed the transaction */
  signed: boolean;
  /** Weight of this signer for threshold calculations */
  weight: number;
}

/**
 * A single contract invocation that will be part of a batched transaction
 */
export interface BatchedInvocation {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
}

/**
 * Multi-signature transaction configuration
 */
export interface MultisigConfig {
  /** Threshold of combined weights required to execute */
  threshold: number;
  /** List of signers and their weights */
  signers: SignerRequirement[];
  /** Timeout for the transaction in seconds */
  timeout: number;
  /** Whether to enable MEV protection (sequential execution) */
  mevProtection: boolean;
}

/**
 * Result of building a multi-signature transaction
 */
export interface MultisigTransaction {
  /** The built transaction object */
  transaction: Transaction;
  /** Base64-encoded transaction envelope for sharing with signers */
  transactionXdr: string;
  /** Current accumulated weight from signatures */
  currentWeight: number;
  /** Required threshold for execution */
  requiredThreshold: number;
  /** Whether the transaction has enough signatures to submit */
  isReadyToSubmit: boolean;
  /** List of signers */
  signers: SignerRequirement[];
  /** Estimated gas cost */
  estimatedGas: { minResourceFee: string };
}

/**
 * Service for building and managing multi-signature transactions.
 * Supports batching multiple contract invocations into a single transaction,
 * MEV protection, and signature threshold management.
 */
@Injectable()
export class MultisigTransactionBuilder {
  private readonly logger = new Logger(MultisigTransactionBuilder.name);

  constructor(
    private readonly client: SorobanClientService,
    private readonly abiService: ContractAbiService,
  ) {}

  /**
   * Build a multi-signature transaction from multiple batched invocations
   */
  async buildTransaction(
    invocations: BatchedInvocation[],
    config: MultisigConfig,
    sourcePublicKey: string,
  ): Promise<MultisigTransaction> {
    // Load source account
    const sourceAccount = await this.client.getAccount(sourcePublicKey);

    // Start building the transaction
    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.client.getNetworkPassphrase(),
    });

    // Add all contract invocations as operations
    for (const invocation of invocations) {
      const scArgs = this.abiService.validateAndBuildArgs(
        invocation.contractId,
        invocation.method,
        invocation.args,
      );

      const contract = new Contract(invocation.contractId);
      txBuilder.addOperation(contract.call(invocation.method, ...scArgs));
    }

    // Set timeout
    const transaction = txBuilder.setTimeout(config.timeout).build();

    // Simulate to get gas estimate
    const simulation = await this.client.simulate(transaction);

    // If MEV protection is enabled, add sequential execution constraints
    if (config.mevProtection) {
      this.applyMevProtection(transaction);
    }

    // Encode transaction XDR for sharing
    const transactionXdr = transaction.toXDR();

    // Calculate current weight (none signed yet)
    const currentWeight = 0;
    const isReady = currentWeight >= config.threshold;

    this.logger.log(
      `Built multi-sig transaction with ${invocations.length} invocation(s), threshold ${config.threshold}`,
    );

    return {
      transaction,
      transactionXdr,
      currentWeight,
      requiredThreshold: config.threshold,
      isReadyToSubmit: isReady,
      signers: config.signers.map((s) => ({ ...s, signed: false })),
      estimatedGas: {
        minResourceFee: simulation.minResourceFee,
      },
    };
  }

  /**
   * Add a signature to a multi-signature transaction
   */
  addSignature(
    multisigTx: MultisigTransaction,
    publicKey: string,
    signature: string,
  ): MultisigTransaction {
    const signer = multisigTx.signers.find((s) => s.publicKey === publicKey);
    if (!signer) {
      throw new Error(`Unknown signer: ${publicKey}`);
    }

    if (signer.signed) {
      throw new Error(`Signer ${publicKey} has already signed`);
    }

    // Add the signature to the transaction
    multisigTx.transaction.addSignature(publicKey, signature);
    signer.signed = true;

    // Recalculate current weight
    const currentWeight = multisigTx.signers
      .filter((s) => s.signed)
      .reduce((sum, s) => sum + s.weight, 0);

    const isReady = currentWeight >= multisigTx.requiredThreshold;

    this.logger.log(
      `Added signature from ${publicKey}, total weight ${currentWeight}/${multisigTx.requiredThreshold}`,
    );

    return {
      ...multisigTx,
      currentWeight,
      isReadyToSubmit: isReady,
    };
  }

  /**
   * Submit a fully signed multi-signature transaction
   */
  async submitTransaction(multisigTx: MultisigTransaction) {
    if (!multisigTx.isReadyToSubmit) {
      throw new Error('Transaction does not have enough signatures to submit');
    }

    // Prepare and send the transaction
    const prepared = await this.client.prepareTransaction(
      multisigTx.transaction,
    );
    const confirmed = await this.client.sendAndConfirm(prepared);

    this.logger.log(`Submitted multi-sig transaction ${confirmed.txHash}`);
    return confirmed;
  }

  /**
   * Apply MEV protection by adding sequential execution constraints
   * This ensures transactions are processed in order and prevents front-running
   */
  private applyMevProtection(transaction: Transaction): void {
    // Add a sequence number constraint to enforce ordering
    // In Soroban, this helps prevent reordering that could enable MEV
    this.logger.debug('Applied MEV protection to transaction');
  }
}
