import { Injectable, Logger } from '@nestjs/common';
import { contract, xdr } from '@stellar/stellar-sdk';
import { SorobanClientService } from './soroban-client.service';
import {
  SorobanApplicationError,
  SorobanValidationError,
  classifySdkError,
} from './soroban.errors';

/**
 * Metadata describing a single contract method, derived from its XDR spec.
 */
export interface ContractFunctionAbi {
  name: string;
  inputs: { name: string; type: string }[];
  outputs: string[];
  doc?: string;
}

/**
 * A registered contract ABI: the parsed `Spec` plus a convenient view of its
 * functions. Cached per contract id so repeat invocations skip re-fetching.
 */
export interface RegisteredAbi {
  contractId: string;
  spec: contract.Spec;
  functions: ContractFunctionAbi[];
}

/**
 * Contract ABI management and validation.
 *
 * A contract's ABI (its XDR spec) is the source of truth for which methods
 * exist and what argument types they take. Registering an ABI lets the module
 * validate invocations before they hit the network — catching unknown methods
 * and malformed arguments as {@link SorobanValidationError}s rather than
 * paying for a round-trip that the host would reject.
 *
 * ABIs can be registered from raw XDR spec entries, or fetched directly from a
 * deployed contract's on-chain WASM.
 */
@Injectable()
export class ContractAbiService {
  private readonly logger = new Logger(ContractAbiService.name);
  private readonly registry = new Map<string, RegisteredAbi>();

  constructor(private readonly client: SorobanClientService) {}

  /**
   * Registers an ABI from base64-encoded XDR spec entries (as emitted by
   * `stellar contract bindings` / `soroban contract inspect`).
   */
  registerFromXdr(contractId: string, specEntriesXdr: string[]): RegisteredAbi {
    if (!specEntriesXdr?.length) {
      throw new SorobanValidationError(
        'Cannot register an ABI with no spec entries.',
        { contractId },
      );
    }
    let spec: contract.Spec;
    try {
      spec = new contract.Spec(specEntriesXdr);
    } catch (error) {
      throw new SorobanValidationError(
        `Invalid contract spec entries: ${(error as Error).message}`,
        { contractId, cause: error },
      );
    }
    return this.store(contractId, spec);
  }

  /**
   * Fetches a deployed contract's spec from its on-chain WASM and registers it.
   * Requires the contract to already exist on the network.
   */
  async registerFromNetwork(contractId: string): Promise<RegisteredAbi> {
    try {
      const client = await contract.Client.from({
        contractId,
        networkPassphrase: this.client.getNetworkPassphrase(),
        rpcUrl: this.client.getServer().serverURL.toString(),
        allowHttp: this.client.getServer().serverURL.protocol() === 'http',
      });
      return this.store(contractId, client.spec);
    } catch (error) {
      throw classifySdkError(error, { contractId });
    }
  }

  /** Returns a registered ABI or throws if the contract is unknown. */
  getAbi(contractId: string): RegisteredAbi {
    const abi = this.registry.get(contractId);
    if (!abi) {
      throw new SorobanApplicationError(
        `No ABI registered for contract ${contractId}. Register it before invoking.`,
        { contractId },
      );
    }
    return abi;
  }

  isRegistered(contractId: string): boolean {
    return this.registry.has(contractId);
  }

  /** Lists the human-readable function signatures of a registered contract. */
  listFunctions(contractId: string): ContractFunctionAbi[] {
    return this.getAbi(contractId).functions;
  }

  /**
   * Validates that `method` exists on the contract and marshals `args` into the
   * ScVals the SDK needs. Throws a {@link SorobanValidationError} on any
   * mismatch — unknown method, missing argument, or wrong type — so invalid
   * operations never reach the network.
   *
   * `args` is a named-argument object keyed by the parameter names in the spec.
   */
  validateAndBuildArgs(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ): xdr.ScVal[] {
    const abi = this.getAbi(contractId);

    const fn = abi.functions.find((f) => f.name === method);
    if (!fn) {
      throw new SorobanValidationError(
        `Contract ${contractId} has no method '${method}'. Known methods: ${abi.functions
          .map((f) => f.name)
          .join(', ')}`,
        { contractId, method },
      );
    }

    try {
      // `funcArgsToScVals` enforces presence and type of every declared input,
      // throwing on any mismatch — exactly the validation we want.
      return abi.spec.funcArgsToScVals(method, args);
    } catch (error) {
      throw new SorobanValidationError(
        `Invalid arguments for ${contractId}.${method}: ${(error as Error).message}`,
        { contractId, method, cause: error },
      );
    }
  }

  /**
   * Decodes a raw return-value ScVal into a native JS value using the method's
   * declared output type.
   */
  decodeResult(contractId: string, method: string, retval: xdr.ScVal): unknown {
    const abi = this.getAbi(contractId);
    try {
      return abi.spec.funcResToNative(method, retval);
    } catch (error) {
      throw new SorobanApplicationError(
        `Failed to decode result of ${contractId}.${method}: ${(error as Error).message}`,
        { contractId, method, cause: error },
      );
    }
  }

  private store(contractId: string, spec: contract.Spec): RegisteredAbi {
    const functions = this.parseFunctions(spec);
    const registered: RegisteredAbi = { contractId, spec, functions };
    this.registry.set(contractId, registered);
    this.logger.log(
      `Registered ABI for ${contractId} with ${functions.length} function(s).`,
    );
    return registered;
  }

  /** Extracts a readable function list from the XDR spec. */
  private parseFunctions(spec: contract.Spec): ContractFunctionAbi[] {
    return spec.funcs().map((fn) => ({
      name: fn.name().toString(),
      doc: fn.doc()?.toString() || undefined,
      inputs: fn.inputs().map((input) => ({
        name: input.name().toString(),
        type: input.type().switch().name,
      })),
      outputs: fn.outputs().map((out) => out.switch().name),
    }));
  }
}
