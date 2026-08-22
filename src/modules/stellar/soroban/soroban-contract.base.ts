import { Logger } from '@nestjs/common';
import { ContractInvocationService } from './contract-invocation.service';
import { ContractRegistryService } from './contract-registry.service';
import { ContractAbiService } from './contract-abi.service';
import { SimulationResult, InvocationResult, GasEstimate } from './soroban.types';

/**
 * Decorator that marks a class as a Soroban contract.
 * Automatically registers the contract type and enables type-safe invocations.
 * 
 * @param contractType Human-readable identifier for the contract type (e.g., "swap-pool")
 * 
 * @example
 * @Contract('swap-pool')
 * export class SwapPoolContract extends SorobanContract {
 *   // Contract-specific methods here
 * }
 */
export function Contract(contractType: string): ClassDecorator {
  return function (target: Function) {
    Reflect.defineMetadata('contract:type', contractType, target);
    target.prototype.contractType = contractType;
  };
}

/**
 * Base abstract class that all specific contract implementations must extend.
 * Provides common functionality for all Soroban contracts with type-safe invocations.
 * 
 * This abstracts away the complexity of direct contract interactions,
 * providing a clean, object-oriented interface for working with contracts.
 */
export abstract class SorobanContract {
  protected readonly logger = new Logger(this.constructor.name);
  protected contractId!: string;
  protected contractType!: string; // Set by @Contract decorator

  constructor(
    protected readonly invocationService: ContractInvocationService,
    protected readonly registry: ContractRegistryService,
    protected readonly abiService: ContractAbiService,
  ) {}

  /**
   * Initialize the contract instance with its on-chain ID
   */
  initialize(contractId: string): void {
    if (!this.registry.isRegistered(contractId)) {
      throw new Error(`Cannot initialize unregistered contract: ${contractId}`);
    }
    
    const metadata = this.registry.getMetadata(contractId);
    if (metadata.type !== this.contractType) {
      throw new Error(
        `Contract type mismatch: expected ${this.contractType}, got ${metadata.type}`,
      );
    }

    this.contractId = contractId;
    this.logger.log(`Initialized ${this.contractType} contract at ${contractId}`);
  }

  /**
   * Type-safe method to simulate a contract call (read-only)
   */
  protected async simulate<T>(
    method: string,
    args?: Record<string, unknown>,
  ): Promise<SimulationResult<T>> {
    this.ensureInitialized();
    return this.invocationService.simulate<T>({
      contractId: this.contractId,
      method,
      args,
    });
  }

  /**
   * Type-safe method to invoke a state-changing contract call
   */
  protected async invoke<T>(
    method: string,
    args?: Record<string, unknown>,
  ): Promise<InvocationResult<T>> {
    this.ensureInitialized();
    return this.invocationService.invoke<T>({
      contractId: this.contractId,
      method,
      args,
    });
  }

  /**
   * Estimate gas for a potential invocation
   */
  protected async estimateGas(
    method: string,
    args?: Record<string, unknown>,
  ): Promise<GasEstimate> {
    this.ensureInitialized();
    return this.invocationService.estimateGas({
      contractId: this.contractId,
      method,
      args,
    });
  }

  /**
   * Get the current contract's metadata
   */
  getMetadata() {
    this.ensureInitialized();
    return this.registry.getMetadata(this.contractId);
  }

  /**
   * Check if this contract has a specific capability
   */
  hasCapability(capability: string): boolean {
    this.ensureInitialized();
    return this.registry.hasCapability(this.contractId, capability);
  }

  /**
   * Helper to ensure the contract is properly initialized before use
   */
  private ensureInitialized(): void {
    if (!this.contractId) {
      throw new Error(
        `Contract ${this.contractType} not initialized. Call initialize() with a contract ID first.`,
      );
    }
  }
}

/**
 * Helper to get the contract type from a contract class
 */
export function getContractType(target: Function): string | undefined {
  return Reflect.getMetadata('contract:type', target);
}