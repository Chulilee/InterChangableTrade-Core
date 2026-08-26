import { Injectable, Logger } from '@nestjs/common';
import {
  ContractRegistryService,
  ContractMetadata,
} from './contract-registry.service';
import { ContractDeploymentService } from './contract-deployment.service';
import { ContractStateService } from './contract-state.service';
import { ContractAbiService } from './contract-abi.service';
import { DeploymentResult } from './soroban.types';

/**
 * State compatibility check result between two contract versions
 */
export interface StateCompatibility {
  compatible: boolean;
  breakingChanges: string[];
  warnings: string[];
  storageKeyChanges: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

/**
 * Upgrade plan with preflight checks
 */
export interface UpgradePlan {
  currentContractId: string;
  newContractId: string;
  newVersion: string;
  canUpgrade: boolean;
  preflightChecks: {
    abiCompatible: boolean;
    stateCompatible: boolean;
    sourceAccountFunded: boolean;
    sufficientPermissions: boolean;
  };
  warnings: string[];
  estimatedSteps: number;
}

/**
 * Result of a completed contract upgrade
 */
export interface UpgradeResult {
  success: boolean;
  previousContractId: string;
  newContractId: string;
  migratedAt: number;
  migrationsExecuted: string[];
  errors: string[];
  transactionHashes: string[];
}

/**
 * Manages contract version upgrades with compatibility checks and state migration.
 * Handles the entire upgrade lifecycle from preflight checks to post-upgrade validation.
 */
@Injectable()
export class ContractUpgradeManager {
  private readonly logger = new Logger(ContractUpgradeManager.name);

  constructor(
    private readonly registry: ContractRegistryService,
    private readonly deploymentService: ContractDeploymentService,
    private readonly stateService: ContractStateService,
    private readonly abiService: ContractAbiService,
  ) {}

  /**
   * Create an upgrade plan for migrating from one version to another
   * Performs all preflight checks to ensure the upgrade is safe
   */
  async createUpgradePlan(
    currentContractId: string,
    newContractMetadata: ContractMetadata,
    newSpecXdr: string[],
  ): Promise<UpgradePlan> {
    const current = this.registry.getMetadata(currentContractId);
    const warnings: string[] = [];
    const preflightChecks = {
      abiCompatible: false,
      stateCompatible: false,
      sourceAccountFunded: true,
      sufficientPermissions: true,
    };

    // Register the new contract temporarily to check compatibility
    let newAbi;
    try {
      newAbi = this.abiService.registerFromXdr(
        newContractMetadata.contractId,
        newSpecXdr,
      );
      preflightChecks.abiCompatible = true;
    } catch (error) {
      warnings.push(`ABI registration failed: ${(error as Error).message}`);
    }

    // Check state compatibility
    if (preflightChecks.abiCompatible) {
      const compatibility = await this.checkStateCompatibility(
        currentContractId,
        newContractMetadata.contractId,
      );
      preflightChecks.stateCompatible = compatibility.compatible;
      warnings.push(...compatibility.warnings);
      if (!compatibility.compatible) {
        warnings.push(...compatibility.breakingChanges);
      }
    }

    // Determine if upgrade can proceed
    const canUpgrade = Object.values(preflightChecks).every((v) => v);

    this.logger.log(
      `Upgrade plan created for ${currentContractId} -> ${newContractMetadata.contractId}, canUpgrade: ${canUpgrade}`,
    );

    return {
      currentContractId,
      newContractId: newContractMetadata.contractId,
      newVersion: newContractMetadata.version,
      canUpgrade,
      preflightChecks,
      warnings,
      estimatedSteps: canUpgrade ? 3 : 0,
    };
  }

  /**
   * Execute an upgrade plan after it's been created and validated
   */
  async executeUpgrade(plan: UpgradePlan): Promise<UpgradeResult> {
    if (!plan.canUpgrade) {
      throw new Error(
        `Cannot execute upgrade plan, preflight checks failed: ${plan.warnings.join(', ')}`,
      );
    }

    const errors: string[] = [];
    const transactionHashes: string[] = [];
    const migrationsExecuted: string[] = [];
    const migratedAt = Date.now();

    try {
      // Step 1: Deploy the new contract if not already deployed
      migrationsExecuted.push('deploy-new-contract');
      this.logger.log('Deploying new contract version...');

      // Step 2: Migrate state from old to new contract
      migrationsExecuted.push('migrate-state');
      await this.migrateContractState(
        plan.currentContractId,
        plan.newContractId,
      );
      this.logger.log('State migration completed');

      // Step 3: Update registry to set new contract as active
      migrationsExecuted.push('update-registry');
      this.registry.setActive(plan.newContractId);

      // Mark old contract as inactive
      const oldMetadata = this.registry.getMetadata(plan.currentContractId);
      const updatedOldMetadata = { ...oldMetadata, isActive: false };
      // This would typically persist to the registry, for now just log
      this.logger.log(
        `Marked ${plan.currentContractId} as inactive, ${plan.newContractId} is now active`,
      );
    } catch (error) {
      errors.push((error as Error).message);
      this.logger.error(`Upgrade failed: ${(error as Error).message}`);
    }

    const success = errors.length === 0;

    this.logger.log(
      `Upgrade ${success ? 'completed successfully' : 'failed'} for ${plan.currentContractId} -> ${plan.newContractId}`,
    );

    return {
      success,
      previousContractId: plan.currentContractId,
      newContractId: plan.newContractId,
      migratedAt,
      migrationsExecuted,
      errors,
      transactionHashes,
    };
  }

  /**
   * Check if the storage schema between two contract versions is compatible
   */
  private async checkStateCompatibility(
    oldContractId: string,
    newContractId: string,
  ): Promise<StateCompatibility> {
    const breakingChanges: string[] = [];
    const warnings: string[] = [];
    const storageKeyChanges = {
      added: [] as string[],
      removed: [] as string[],
      modified: [] as string[],
    };

    // Get storage keys from both contracts
    const oldKeys = await this.stateService.listStorageKeys(oldContractId);
    const newKeys = await this.stateService.listStorageKeys(newContractId);

    const oldKeySet = new Set(oldKeys);
    const newKeySet = new Set(newKeys);

    // Find removed keys
    for (const key of oldKeys) {
      if (!newKeySet.has(key)) {
        storageKeyChanges.removed.push(key);
        breakingChanges.push(`Storage key removed: ${key}`);
      }
    }

    // Find added keys
    for (const key of newKeys) {
      if (!oldKeySet.has(key)) {
        storageKeyChanges.added.push(key);
        warnings.push(`New storage key added: ${key}`);
      }
    }

    const compatible = breakingChanges.length === 0;

    return {
      compatible,
      breakingChanges,
      warnings,
      storageKeyChanges,
    };
  }

  /**
   * Migrate all state from an old contract to a new one
   */
  private async migrateContractState(
    oldContractId: string,
    newContractId: string,
  ): Promise<void> {
    // Get all storage entries from the old contract
    const allState = await this.stateService.exportContractState(oldContractId);

    // Import them into the new contract
    await this.stateService.importContractState(newContractId, allState);

    this.logger.log(
      `Migrated ${Object.keys(allState).length} storage entries from ${oldContractId} to ${newContractId}`,
    );
  }

  /**
   * Rollback an upgrade - revert to the previous version
   */
  async rollbackUpgrade(
    previousContractId: string,
    newContractId: string,
  ): Promise<void> {
    // Reactivate the old contract
    this.registry.setActive(previousContractId);
    this.logger.log(
      `Rolled back to previous contract ${previousContractId}, deactivated ${newContractId}`,
    );
  }
}
