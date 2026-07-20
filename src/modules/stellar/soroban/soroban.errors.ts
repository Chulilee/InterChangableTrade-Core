/**
 * Soroban error hierarchy.
 *
 * The acceptance criteria require that callers can distinguish between network,
 * contract, and application failures. We model that with a small hierarchy of
 * typed errors, each mapped to an appropriate HTTP status so the errors surface
 * cleanly through NestJS's exception layer while remaining programmatically
 * inspectable via `instanceof` and the `category` discriminator.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export enum SorobanErrorCategory {
  /** Transport/RPC-level failures: endpoint unreachable, timeouts, 5xx. */
  NETWORK = 'network',
  /** The contract executed but rejected the call: trap, panic, auth failure. */
  CONTRACT = 'contract',
  /** Our own misuse: unknown method, bad args, unregistered ABI, no signer. */
  APPLICATION = 'application',
  /** Input failed validation before we ever reached the network. */
  VALIDATION = 'validation',
}

export interface SorobanErrorDetails {
  contractId?: string;
  method?: string;
  /** Raw diagnostic strings from the RPC/host, when available. */
  diagnostics?: string[];
  /** The original error, preserved for logging (never serialized to clients). */
  cause?: unknown;
}

/**
 * Base class for every failure the Soroban module raises. Extends HttpException
 * so it flows through Nest's default exception filter, but carries a `category`
 * and structured `details` for callers that catch and branch on it.
 */
export abstract class SorobanError extends HttpException {
  abstract readonly category: SorobanErrorCategory;
  readonly details: SorobanErrorDetails;

  constructor(
    message: string,
    status: HttpStatus,
    details: SorobanErrorDetails = {},
  ) {
    super(
      {
        message,
        // `category` is filled in by subclasses; read lazily in toJSON below.
        error: message,
      },
      status,
    );
    this.details = details;
  }

  /** Machine-readable shape for logging and structured API responses. */
  toDetail() {
    return {
      category: this.category,
      message: this.message,
      contractId: this.details.contractId,
      method: this.details.method,
      diagnostics: this.details.diagnostics,
    };
  }
}

/**
 * The RPC endpoint could not be reached or returned a transport-level failure.
 * These are typically transient and safe to retry.
 */
export class SorobanNetworkError extends SorobanError {
  readonly category = SorobanErrorCategory.NETWORK;

  constructor(message: string, details: SorobanErrorDetails = {}) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, details);
  }
}

/**
 * The contract was reached and executed, but the invocation failed on-chain:
 * a host trap, a `panic!`, an assertion, or a rejected authorization. Retrying
 * the same call verbatim will fail the same way.
 */
export class SorobanContractError extends SorobanError {
  readonly category = SorobanErrorCategory.CONTRACT;

  constructor(message: string, details: SorobanErrorDetails = {}) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

/**
 * The caller used the module incorrectly: invoking an unknown method, an ABI
 * that was never registered, or a write with no configured signer.
 */
export class SorobanApplicationError extends SorobanError {
  readonly category = SorobanErrorCategory.APPLICATION;

  constructor(
    message: string,
    details: SorobanErrorDetails = {},
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status, details);
  }
}

/**
 * Input failed validation before any network call. Distinct from
 * ApplicationError so ABI/argument marshaling problems can be surfaced with
 * precise field-level context.
 */
export class SorobanValidationError extends SorobanError {
  readonly category = SorobanErrorCategory.VALIDATION;

  constructor(message: string, details: SorobanErrorDetails = {}) {
    super(message, HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * Best-effort classification of an arbitrary error thrown by the Stellar SDK or
 * the underlying HTTP client into a network vs. contract failure. Used when we
 * only have a generic `Error` in hand (e.g. a thrown `sendTransaction`).
 */
export function classifySdkError(
  error: unknown,
  details: SorobanErrorDetails = {},
): SorobanError {
  if (error instanceof SorobanError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  const networkSignals = [
    'timeout',
    'timed out',
    'econnrefused',
    'econnreset',
    'enotfound',
    'network',
    'socket',
    'fetch failed',
    'getaddrinfo',
    'request failed with status code 5',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
  ];

  if (networkSignals.some((s) => lower.includes(s))) {
    return new SorobanNetworkError(`Soroban RPC unreachable: ${message}`, {
      ...details,
      cause: error,
    });
  }

  // Host-function / contract execution signals.
  const contractSignals = [
    'hostfunctionerror',
    'trapped',
    'trap',
    'invokehostfunction',
    'contract',
    'unreachable',
    'auth',
    'unauthorized',
  ];

  if (contractSignals.some((s) => lower.includes(s))) {
    return new SorobanContractError(`Contract execution failed: ${message}`, {
      ...details,
      cause: error,
    });
  }

  // Default to application error: something we did wrong that isn't clearly
  // network or contract.
  return new SorobanApplicationError(message, { ...details, cause: error });
}
