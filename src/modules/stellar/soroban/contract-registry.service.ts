import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractAbiService, RegisteredAbi } from './contract-abi.service';

/**
 * Complete metadata for a registered contract in the registry.
 * Stores version information, capabilities, and upgrade history.
 */
export interface ContractMetadata {
  /** Unique contract identifier (C... address) */
  contractId: string;
  /** Human-readable contract type/name (e.g., "swap-pool", "escrow-factory") */
  type: string;
  /** Semantic version of the contract */
  version: string;
  /** List of capabilities this contract exposes */
  capabilities: string[];
  /** Deployment timestamp */
  deployedAt: number;
  /** Previous contract versions for upgrade tracking */
  previousVersions?: string[];
  /** Whether this is the current active version */
  isActive: boolean;
  /** Additional arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Registry entry combining metadata and ABI
 */
interface RegistryEntry {
  metadata: ContractMetadata;
  abi?: RegisteredAbi;
}

/**
 * Centralized contract registry that manages all deployed contracts.
 * Stores metadata, tracks versions, and provides lookup capabilities.
 * This is the single source of truth for all contracts in the system.
 */
@Injectable()
export class ContractRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ContractRegistryService.name);
  private readonly registry = new Map<string, RegistryEntry>();
  private readonly typeIndex = new Map<string, string[]>(); // contract type -> contractIds

  constructor(
    private readonly abiService: ContractAbiService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Contract Registry Service initialized');
  }

  /**
   * Register a new contract in the registry
   */
  register(
    contractMetadata: ContractMetadata,
    specEntriesXdr?: string[],
  ): ContractMetadata {
    if (this.registry.has(contractMetadata.contractId)) {
      this.logger.warn(
        `Contract ${contractMetadata.contractId} is already registered, updating metadata`,
      );
    }

    // Register ABI if provided
    if (specEntriesXdr) {
      this.abiService.registerFromXdr(
        contractMetadata.contractId,
        specEntriesXdr,
      );
    }

    const entry: RegistryEntry = {
      metadata: contractMetadata,
    };

    this.registry.set(contractMetadata.contractId, entry);

    // Update type index
    const typeContracts = this.typeIndex.get(contractMetadata.type) || [];
    if (!typeContracts.includes(contractMetadata.contractId)) {
      typeContracts.push(contractMetadata.contractId);
      this.typeIndex.set(contractMetadata.type, typeContracts);
    }

    this.logger.log(
      `Registered contract ${contractMetadata.contractId} (${contractMetadata.type} v${contractMetadata.version})`,
    );

    return contractMetadata;
  }

  /**
   * Get contract metadata by ID
   */
  getMetadata(contractId: string): ContractMetadata {
    const entry = this.registry.get(contractId);
    if (!entry) {
      throw new Error(`Contract ${contractId} not found in registry`);
    }
    return entry.metadata;
  }

  /**
   * Get all contracts of a specific type
   */
  getContractsByType(type: string): ContractMetadata[] {
    const contractIds = this.typeIndex.get(type) || [];
    return contractIds.map((id) => this.getMetadata(id));
  }

  /**
   * Get the active contract for a specific type
   */
  getActiveContract(type: string): ContractMetadata | null {
    const contracts = this.getContractsByType(type);
    const active = contracts.find((c) => c.isActive);
    return active || null;
  }

  /**
   * List all registered contracts
   */
  listAll(): ContractMetadata[] {
    return Array.from(this.registry.values()).map((e) => e.metadata);
  }

  /**
   * Check if a contract is registered
   */
  isRegistered(contractId: string): boolean {
    return this.registry.has(contractId);
  }

  /**
   * Mark a contract as the active version for its type, deactivating others
   */
  setActive(contractId: string): void {
    const entry = this.registry.get(contractId);
    if (!entry) {
      throw new Error(`Cannot activate unknown contract ${contractId}`);
    }

    // Deactivate all other contracts of the same type
    const typeContracts = this.typeIndex.get(entry.metadata.type) || [];
    for (const id of typeContracts) {
      const otherEntry = this.registry.get(id);
      if (otherEntry && id !== contractId) {
        otherEntry.metadata.isActive = false;
      }
    }

    // Activate this contract
    entry.metadata.isActive = true;
    this.logger.log(
      `Set ${contractId} (${entry.metadata.type}) as active version`,
    );
  }

  /**
   * Check if a contract has a specific capability
   */
  hasCapability(contractId: string, capability: string): boolean {
    try {
      const metadata = this.getMetadata(contractId);
      return metadata.capabilities.includes(capability);
    } catch {
      return false;
    }
  }
}
