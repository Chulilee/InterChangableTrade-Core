import { Injectable, Logger } from '@nestjs/common';
import {
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  Contract,
} from '@stellar/stellar-sdk';
import { SorobanClientService } from './soroban-client.service';
import { ContractAbiService } from './contract-abi.service';
import { SorobanApplicationError } from './soroban.errors';

/**
 * Stellar caps a transaction at 100 operations.
 */
const MAX_OPERATIONS_PER_TX = 100;

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
}

/**
 * Result of building a multi-signature transaction
 */
export interface MultisigTransaction {
  /** The prepared (final) transaction object */
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
 * Supports batching multiple contract invocations into a single transaction
 * and threshold-based signature collection.
 *
 * Contract of `MultisigTransaction` handling (do not break these invariants):
 *
 * 1. **Preparation precedes signing.** `buildTransaction` runs Soroban
 *    simulation/preparation (resource footprint + fees) and only then exposes
 *    the finalized envelope. Re-deriving resources after signatures have been
 *    collected changes the transaction hash and invalidates every signature
 *    already gathered, so `submitTransaction` never re-prepares.
 * 2. **The XDR is regenerated on every `addSignature` call.** Signers 2..N
 *    therefore always receive an envelope that already carries signatures
 *    1..k-1; persist `transactionXdr` when sharing it.
 * 3. **`addSignature` mutates in place and returns the same reference.** It is
 *    safe to ignore the return value — accumulated state is still visible on
 *    the object you passed in.
 * 4. **MEV protection is not offered.** The previous implementation had an
 *    `applyMevProtection` that only logged "MEV protection applied"; a no-op
 *    that pretends to guarantee ordering is worse than its absence, so the
 *    flag was removed instead of implemented. Real Soroban ordering can only
 *    be enforced by contract-level access control (e.g. a sequencer signer).
 */
@Injectable()
export class MultisigTransactionBuilder {
  private readonly logger = new Logger(MultisigTransactionBuilder.name);

  constructor(
    private readonly client: SorobanClientService,
    private readonly abiService: ContractAbiService,
  ) {}

  /**
   * Build a multi-signature transaction from multiple batched invocations.
   *
   * Simulation and preparation happen here, before any signature exists, so
   * the returned envelope is final and stable for all signers.
   */
  async buildTransaction(
    invocations: BatchedInvocation[],
    config: MultisigConfig,
    sourcePublicKey: string,
  ): Promise<MultisigTransaction> {
    if (
      !Number.isInteger(invocations.length) ||
      invocations.length > MAX_OPERATIONS_PER_TX
    ) {
      throw new SorobanApplicationError(
        `Batched multi-signature transaction contains ${invocations.length} invocation(s), but Stellar transactions are limited to ${MAX_OPERATIONS_PER_TX} operations. Split the batch into multiple transactions.`,
      );
    }

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

    // Set timeout and build the envelope
    const built = txBuilder.setTimeout(config.timeout).build();

    // Simulate to get a gas estimate.
    const simulation = await this.client.simulate(built);

    // Prepare the transaction NOW, while it carries zero signatures. Once
    // prepared, its fees and footprint are final and its hash is stable, so
    // every signature collected afterwards remains valid.
    const transaction = await this.client.prepareTransaction(built);

    // Encode the finalized transaction XDR for sharing with signers
    const transactionXdr = transaction.toXDR();

    // Calculate current weight (none signed yet)
    const currentWeight = 0;
    const isReady = currentWeight >= config.threshold;

    this.logger.log(
      `Built multi-signature transaction with ${invocations.length} invocation(s), threshold ${config.threshold}`,
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
   * Add a signature to a multi-signature transaction.
   *
   * The supplied `MultisigTransaction` is mutated in place and the same
   * reference is returned. `transactionXdr` is regenerated from the enlarged
   * envelope, so each signer receives an XDR that already includes all prior
   * signatures.
   */
  addSignature(
    multisigTx: MultisigTransaction,
    publicKey: string,
    signature: string,
  ): MultisigTransaction {
    const signer = multisigTx.signers.find((s) => s.publicKey === publicKey);
    if (!signer) {
      throw new SorobanApplicationError(`Unknown signer: ${publicKey}`);
    }

    if (signer.signed) {
      throw new SorobanApplicationError(
        `Signer ${publicKey} has already signed`,
      );
    }

    // Add the signature to the transaction
    multisigTx.transaction.addSignature(publicKey, signature);
    signer.signed = true;

    // Recalculate accumulated weight
    multisigTx.currentWeight = multisigTx.signers
      .filter((s) => s.signed)
      .reduce((sum, s) => sum + s.weight, 0);

    multisigTx.isReadyToSubmit =
      multisigTx.currentWeight >= multisigTx.requiredThreshold;

    // Regenerate the envelope XDR so later signers see the accumulated
    // signatures.
    multisigTx.transactionXdr = multisigTx.transaction.toXDR();

    this.logger.log(
      `Added signature from ${publicKey}, total weight ${multisigTx.currentWeight}/${multisigTx.requiredThreshold}`,
    );

    return multisigTx;
  }

  /**
   * Submit a fully signed multi-signature transaction.
   *
   * No re-preparation happens here: the transaction was finalized before the
   * first signature was collected (see the class contract), and preparing
   * again would invalidate every signature.
   */
  async submitTransaction(multisigTx: MultisigTransaction) {
    if (!multisigTx.isReadyToSubmit) {
      throw new SorobanApplicationError(
        'Transaction does not have enough signatures to submit',
      );
    }

    const confirmed = await this.client.sendAndConfirm(multisigTx.transaction);

    this.logger.log(`Submitted multi-signature transaction ${confirmed.txHash}`);
    return confirmed;
  }
}
