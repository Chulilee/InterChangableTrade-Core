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

    // Store a copy so later setActive() mutations never mutate the caller's object.
    const metadata = this.copyMetadata(contractMetadata);

    // Enforce the "one active version per type" invariant: registering an
    // active contract deactivates any previously active sibling.
    if (metadata.isActive) {
      const siblings = this.typeIndex.get(metadata.type) || [];
      for (const id of siblings) {
        if (id === metadata.contractId) {
          continue;
        }
        const sibling = this.registry.get(id);
        if (sibling) {
          sibling.metadata.isActive = false;
        }
      }
    }

    const entry: RegistryEntry = {
      metadata,
    };

    this.registry.set(metadata.contractId, entry);

    // Update type index
    const typeContracts = this.typeIndex.get(metadata.type) || [];
    if (!typeContracts.includes(metadata.contractId)) {
      typeContracts.push(metadata.contractId);
      this.typeIndex.set(metadata.type, typeContracts);
    }

    // Copy again for type-change reindexing safety: if the type changed
    // for an existing id, the old index entry stays (callers may look up
    // by old type), but the stored metadata is the source of truth.
    this.logger.log(
      `Registered contract ${metadata.contractId} (${metadata.type} v${metadata.version})`,
    );

    return this.copyMetadata(entry.metadata);
  }

  /**
   * Get contract metadata by ID
   */
  getMetadata(contractId: string): ContractMetadata {
    const entry = this.registry.get(contractId);
    if (!entry) {
      throw new Error(`Contract ${contractId} not found in registry`);
    }
    return this.copyMetadata(entry.metadata);
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
    return Array.from(this.registry.values()).map((e) =>
      this.copyMetadata(e.metadata),
    );
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

  /** Defensive copy so callers can never mutate registry state (or vice versa). */
  private copyMetadata(metadata: ContractMetadata): ContractMetadata {
    return {
      ...metadata,
      capabilities: [...(metadata.capabilities ?? [])],
      previousVersions: metadata.previousVersions
        ? [...metadata.previousVersions]
        : undefined,
      metadata: metadata.metadata ? { ...metadata.metadata } : undefined,
    };
  }
}
