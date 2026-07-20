import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { SorobanClientService } from './soroban-client.service';
import { ContractAbiService } from './contract-abi.service';
import { SorobanContractError, classifySdkError } from './soroban.errors';
import {
  GasEstimate,
  InvocationResult,
  SimulationResult,
} from './soroban.types';

/** Options shared by read and write invocations. */
export interface InvokeOptions {
  contractId: string;
  method: string;
  /** Named-argument object, keyed by the parameter names in the contract spec. */
  args?: Record<string, unknown>;
}

/**
 * Standardized Soroban contract invocation interface.
 *
 * Every call flows through the same three phases — build, simulate, (optionally)
 * submit — so gas estimation, ABI validation, and error classification behave
 * identically for reads and writes:
 *
 *  - {@link simulate} runs a read-only call. It builds and simulates the
 *    transaction without submitting, decoding the return value and reporting the
 *    projected resource fee. Nothing is signed and no signer is required.
 *  - {@link invoke} performs a state-changing call. It simulates first (for gas
 *    estimation and footprint assembly), then signs with the configured server
 *    signer and submits, polling until the transaction settles.
 *
 * Arguments are always validated against the registered ABI before a call
 * leaves the process, so unknown methods and malformed arguments surface as
 * validation errors rather than wasted round-trips.
 */
@Injectable()
export class ContractInvocationService {
  private readonly logger = new Logger(ContractInvocationService.name);
  private readonly txTimeoutSecs: number;

  constructor(
    private readonly client: SorobanClientService,
    private readonly abi: ContractAbiService,
    private readonly configService: ConfigService,
  ) {
    this.txTimeoutSecs =
      this.configService.get<number>('soroban.transactionTimeoutSecs') ?? 30;
  }

  /**
   * Read-only invocation. Builds and simulates the call, decodes the return
   * value with the contract's ABI, and reports the estimated resource fee.
   * Requires no signer and submits nothing to the network.
   */
  async simulate<T = unknown>(
    options: InvokeOptions,
  ): Promise<SimulationResult<T>> {
    const { contractId, method } = options;
    const scArgs = this.abi.validateAndBuildArgs(
      contractId,
      method,
      options.args,
    );

    // Reads don't mutate state, so any account works as the transaction source.
    // We use the server signer when present, otherwise a well-known read-only
    // placeholder, since simulation never checks the source's signature.
    const sourcePublicKey = this.client.hasSigner()
      ? this.client.requireSigner().publicKey()
      : READ_ONLY_SOURCE;

    const tx = await this.buildInvocationTx(
      sourcePublicKey,
      contractId,
      method,
      scArgs,
    );
    const sim = await this.client.simulate(tx);

    if (!sim.result) {
      throw new SorobanContractError(
        `Simulation of ${contractId}.${method} returned no result`,
        { contractId, method },
      );
    }

    return {
      contractId,
      method,
      result: this.abi.decodeResult(contractId, method, sim.result.retval) as T,
      gas: this.toGasEstimate(sim),
      latestLedger: sim.latestLedger,
    };
  }

  /**
   * Estimates the gas/resource cost of an invocation without submitting it.
   * Useful for surfacing cost to a user before they commit to a write.
   */
  async estimateGas(options: InvokeOptions): Promise<GasEstimate> {
    const { contractId, method } = options;
    const scArgs = this.abi.validateAndBuildArgs(
      contractId,
      method,
      options.args,
    );
    const sourcePublicKey = this.client.hasSigner()
      ? this.client.requireSigner().publicKey()
      : READ_ONLY_SOURCE;
    const tx = await this.buildInvocationTx(
      sourcePublicKey,
      contractId,
      method,
      scArgs,
    );
    const sim = await this.client.simulate(tx);
    return this.toGasEstimate(sim);
  }

  /**
   * State-changing invocation. Simulates for gas estimation and footprint
   * assembly, signs with the server signer, submits, and polls to confirmation.
   * Throws a {@link SorobanApplicationError} if no signer is configured.
   */
  async invoke<T = unknown>(
    options: InvokeOptions,
  ): Promise<InvocationResult<T>> {
    const { contractId, method } = options;
    const signer = this.client.requireSigner();
    const scArgs = this.abi.validateAndBuildArgs(
      contractId,
      method,
      options.args,
    );

    const built = await this.buildInvocationTx(
      signer.publicKey(),
      contractId,
      method,
      scArgs,
    );

    // Simulate to obtain the resource footprint and fee, then assemble a
    // ready-to-sign transaction that carries them.
    const sim = await this.client.simulate(built);
    const gas = this.toGasEstimate(sim);
    const prepared = await this.client.prepareTransaction(built);

    prepared.sign(signer);

    const confirmed = await this.client.sendAndConfirm(prepared);

    let result: T | undefined;
    if (confirmed.returnValue) {
      result = this.abi.decodeResult(
        contractId,
        method,
        confirmed.returnValue,
      ) as T;
    }

    this.logger.log(
      `Invoked ${contractId}.${method} -> tx ${confirmed.txHash} (ledger ${confirmed.ledger})`,
    );

    return {
      contractId,
      method,
      transactionHash: confirmed.txHash,
      status: 'SUCCESS',
      result,
      ledger: confirmed.ledger,
      gas,
    };
  }

  /**
   * Builds an unsigned contract-invocation transaction. Shared by the read and
   * write paths so both estimate gas and validate arguments identically.
   */
  private async buildInvocationTx(
    sourcePublicKey: string,
    contractId: string,
    method: string,
    scArgs: ReturnType<ContractAbiService['validateAndBuildArgs']>,
  ) {
    try {
      const account = await this.loadSourceAccount(sourcePublicKey);
      const contract = new Contract(contractId);
      return new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.client.getNetworkPassphrase(),
      })
        .addOperation(contract.call(method, ...scArgs))
        .setTimeout(this.txTimeoutSecs)
        .build();
    } catch (error) {
      throw classifySdkError(error, { contractId, method });
    }
  }

  /**
   * Loads the source account for building. In read-only mode the placeholder
   * source may not exist on-chain, so we fall back to a synthetic account —
   * simulation ignores the sequence number for reads.
   */
  private async loadSourceAccount(publicKey: string): Promise<Account> {
    try {
      return await this.client.getAccount(publicKey);
    } catch (error) {
      if (publicKey === READ_ONLY_SOURCE) {
        return new Account(publicKey, '0');
      }
      throw error;
    }
  }

  private toGasEstimate(
    sim: rpc.Api.SimulateTransactionSuccessResponse,
  ): GasEstimate {
    return {
      minResourceFee: sim.minResourceFee,
      cpuInstructions: sim.cost?.cpuInsns,
      memoryBytes: sim.cost?.memBytes,
    };
  }
}

/**
 * A deterministic, well-formed public key used as the source for read-only
 * simulations when no server signer is configured. It is the public key of the
 * all-zero seed and holds no funds; simulation never validates its signature or
 * balance.
 */
const READ_ONLY_SOURCE =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
