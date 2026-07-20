/**
 * Shared types for the Soroban smart-contract integration module. Kept free of
 * SDK-XDR types at the boundary so controllers, DTOs, and consumers work with
 * plain JSON-friendly shapes.
 */

/** Result of estimating the on-chain cost of an invocation via simulation. */
export interface GasEstimate {
  /** Minimum resource fee in stroops (1 XLM = 10^7 stroops). */
  minResourceFee: string;
  /** CPU instructions the invocation is projected to consume. */
  cpuInstructions?: string;
  /** Memory bytes the invocation is projected to consume. */
  memoryBytes?: string;
}

/** Outcome of a read-only (simulated) contract call. */
export interface SimulationResult<T = unknown> {
  contractId: string;
  method: string;
  /** Native (JS) decoding of the contract's return value. */
  result: T;
  gas: GasEstimate;
  latestLedger: number;
}

/** Outcome of a signed, submitted contract invocation. */
export interface InvocationResult<T = unknown> {
  contractId: string;
  method: string;
  transactionHash: string;
  status: 'SUCCESS' | 'FAILED';
  /** Native decoding of the return value, when the call produced one. */
  result?: T;
  ledger?: number;
  gas: GasEstimate;
}

/** A single parsed contract event, normalized for indexing and querying. */
export interface ParsedContractEvent {
  /** RPC event id — unique and monotonic, used as the dedupe/index key. */
  id: string;
  contractId: string;
  type: 'contract' | 'system' | 'diagnostic';
  ledger: number;
  ledgerClosedAt: string;
  /** Topics decoded to native values (the first is usually the event name). */
  topics: unknown[];
  /** Event body decoded to a native value. */
  value: unknown;
  txHash: string;
  pagingToken: string;
  /** Epoch millis at which our indexer captured the event. */
  indexedAt: number;
}

/** Result of deploying (uploading + instantiating) a contract. */
export interface DeploymentResult {
  /** Hash of the uploaded WASM, reusable across many contract instances. */
  wasmHash: string;
  /** The deployed contract's id (C...), present once instantiated. */
  contractId?: string;
  transactionHash: string;
}

/** Network/health snapshot of the configured Soroban RPC endpoint. */
export interface SorobanNetworkStatus {
  rpcUrl: string;
  passphrase: string;
  network: string;
  healthy: boolean;
  latestLedger?: number;
  protocolVersion?: number;
}
