import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  Address,
  BASE_FEE,
  Operation,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { SorobanClientService } from './soroban-client.service';
import { ContractInvocationService } from './contract-invocation.service';
import {
  SorobanApplicationError,
  SorobanContractError,
  classifySdkError,
} from './soroban.errors';
import { DeploymentResult, InvocationResult } from './soroban.types';

/** A compiled contract's WASM bytecode plus, optionally, constructor args. */
export interface DeployContractOptions {
  /** Raw WASM bytecode of the compiled contract. */
  wasm: Buffer;
  /** Optional 32-byte salt for deterministic contract-id derivation. */
  salt?: Buffer;
}

/** Options for deploying a contract instance from an already-uploaded WASM. */
export interface InstantiateOptions {
  wasmHash: string;
  salt?: Buffer;
}

/**
 * Contract lifecycle management: deployment, upgrade, and initialization.
 *
 * Deploying a Soroban contract is two on-chain steps:
 *   1. Upload the compiled WASM, yielding a reusable `wasmHash`.
 *   2. Instantiate a contract instance that points at that hash, yielding the
 *      contract id (`C...`).
 *
 * {@link deploy} runs both in sequence for the common case; {@link uploadWasm}
 * and {@link instantiate} expose the individual steps so a single WASM can back
 * many contract instances. All writes require a configured server signer.
 */
@Injectable()
export class ContractDeploymentService {
  private readonly logger = new Logger(ContractDeploymentService.name);
  private readonly txTimeoutSecs: number;

  constructor(
    private readonly client: SorobanClientService,
    private readonly invocation: ContractInvocationService,
    private readonly configService: ConfigService,
  ) {
    this.txTimeoutSecs =
      this.configService.get<number>('soroban.transactionTimeoutSecs') ?? 30;
  }

  /**
   * Uploads WASM and instantiates a contract in one flow. Returns the wasm
   * hash, the new contract id, and the instantiation transaction hash.
   */
  async deploy(options: DeployContractOptions): Promise<DeploymentResult> {
    const upload = await this.uploadWasm(options.wasm);
    const instance = await this.instantiate({
      wasmHash: upload.wasmHash,
      salt: options.salt,
    });
    return {
      wasmHash: upload.wasmHash,
      contractId: instance.contractId,
      transactionHash: instance.transactionHash,
    };
  }

  /**
   * Uploads compiled WASM bytecode to the network. The resulting hash is a
   * content address that can back any number of contract instances.
   */
  async uploadWasm(wasm: Buffer): Promise<DeploymentResult> {
    if (!wasm?.length) {
      throw new SorobanApplicationError('Cannot upload empty WASM bytecode.');
    }
    const signer = this.client.requireSigner();

    const built = await this.buildTx(signer.publicKey(), (builder) =>
      builder.addOperation(Operation.uploadContractWasm({ wasm })),
    );

    const prepared = await this.client.prepareTransaction(built);
    prepared.sign(signer);
    const confirmed = await this.client.sendAndConfirm(prepared);

    if (!confirmed.returnValue) {
      throw new SorobanContractError(
        'WASM upload succeeded but returned no wasm hash',
      );
    }
    // The host returns the 32-byte wasm hash as an ScVal bytes value.
    const wasmHash = Buffer.from(scValToNative(confirmed.returnValue)).toString(
      'hex',
    );

    this.logger.log(
      `Uploaded WASM ${wasmHash} in tx ${confirmed.txHash} (ledger ${confirmed.ledger})`,
    );

    return { wasmHash, transactionHash: confirmed.txHash };
  }

  /**
   * Instantiates a new contract instance from an uploaded wasm hash. A random
   * salt is used unless one is supplied, so repeat calls yield distinct ids.
   */
  async instantiate(options: InstantiateOptions): Promise<DeploymentResult> {
    const signer = this.client.requireSigner();
    const salt = options.salt ?? randomBytes(32);
    const wasmHashBuf = Buffer.from(options.wasmHash, 'hex');
    if (wasmHashBuf.length !== 32) {
      throw new SorobanApplicationError(
        `wasmHash must be a 32-byte hex string, got ${wasmHashBuf.length} bytes.`,
      );
    }

    const built = await this.buildTx(signer.publicKey(), (builder) =>
      builder.addOperation(
        Operation.createCustomContract({
          address: Address.fromString(signer.publicKey()),
          wasmHash: wasmHashBuf,
          salt,
        }),
      ),
    );

    const prepared = await this.client.prepareTransaction(built);
    prepared.sign(signer);
    const confirmed = await this.client.sendAndConfirm(prepared);

    if (!confirmed.returnValue) {
      throw new SorobanContractError(
        'Contract instantiation succeeded but returned no contract address',
      );
    }
    // The host returns the new contract's address as an ScVal.
    const contractId = Address.fromScVal(confirmed.returnValue).toString();

    this.logger.log(
      `Instantiated contract ${contractId} from wasm ${options.wasmHash} in tx ${confirmed.txHash}`,
    );

    return {
      wasmHash: options.wasmHash,
      contractId,
      transactionHash: confirmed.txHash,
    };
  }

  /**
   * Initializes a freshly deployed contract by invoking its constructor-style
   * method (commonly `initialize` or `__constructor`). This is a normal signed
   * invocation; the ABI for `contractId` must be registered first.
   */
  async initialize(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<InvocationResult> {
    return this.invocation.invoke({ contractId, method, args });
  }

  /**
   * Upgrades a deployed contract to new WASM. Uploads the bytecode (if not
   * already present) and invokes the contract's own upgrade entrypoint, which
   * by convention takes the new `wasm_hash`. The contract must expose such a
   * method and authorize the caller as its admin.
   */
  async upgrade(
    contractId: string,
    newWasm: Buffer,
    upgradeMethod = 'upgrade',
    wasmHashArgName = 'new_wasm_hash',
  ): Promise<InvocationResult> {
    const { wasmHash } = await this.uploadWasm(newWasm);
    return this.invocation.invoke({
      contractId,
      method: upgradeMethod,
      args: { [wasmHashArgName]: Buffer.from(wasmHash, 'hex') },
    });
  }

  /** Builds an unsigned transaction from the configured source account. */
  private async buildTx(
    sourcePublicKey: string,
    addOps: (builder: TransactionBuilder) => TransactionBuilder,
  ) {
    try {
      const account = await this.client.getAccount(sourcePublicKey);
      const builder = new TransactionBuilder(account as Account, {
        fee: BASE_FEE,
        networkPassphrase: this.client.getNetworkPassphrase(),
      });
      return addOps(builder).setTimeout(this.txTimeoutSecs).build();
    } catch (error) {
      throw classifySdkError(error);
    }
  }
}
