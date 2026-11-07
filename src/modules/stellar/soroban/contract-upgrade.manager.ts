import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContractRegistryService,
  ContractMetadata,
} from './contract-registry.service';
import { ContractDeploymentService } from './contract-deployment.service';
import { ContractStateService } from './contract-state.service';
import { ContractAbiService } from './contract-abi.service';
import { SorobanClientService } from './soroban-client.service';
import { SorobanApplicationError } from './soroban.errors';

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
  /** WASM bytecode to deploy for the new version; required by executeUpgrade. */
  newWasm?: Buffer;
  /** Optional deterministic salt for instantiation. */
  salt?: Buffer;
  /** ABI spec entries for the new version (re-registered under the deployed id). */
  newSpecXdr?: string[];
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
    @Optional()
    private readonly client?: SorobanClientService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  /**
   * Create an upgrade plan for migrating from one version to another
   * Performs all preflight checks to ensure the upgrade is safe
   */
  async createUpgradePlan(
    currentContractId: string,
    newContractMetadata: ContractMetadata,
    newSpecXdr: string[],
    newWasm?: Buffer,
    salt?: Buffer,
  ): Promise<UpgradePlan> {
    this.registry.getMetadata(currentContractId); // fails loudly when unknown
    const warnings: string[] = [];
    const preflightChecks = {
      abiCompatible: false,
      stateCompatible: false,
      sourceAccountFunded: false,
      sufficientPermissions: false,
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

    // Real funding/permission checks (previously hardcoded true).
    const sourceCheck = await this.checkSourceAccount();
    preflightChecks.sourceAccountFunded = sourceCheck.funded;
    preflightChecks.sufficientPermissions = sourceCheck.permitted;
    warnings.push(...sourceCheck.warnings);

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
      newWasm,
      salt,
      newSpecXdr,
    };
  }

  /**
   * Execute an upgrade plan after it's been created and validated.
   *
   * Actually deploys the new WASM via ContractDeploymentService, migrates
   * state (failing loudly when migration is unsupported), and persists the
   * registry change so the previous contract is marked inactive. A failed
   * step yields `success: false` with the failure in `errors`.
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
    let deployedContractId = plan.newContractId;

    try {
      // Step 1: Actually upload + instantiate the new contract version.
      if (!plan.newWasm || plan.newWasm.length === 0) {
        throw new SorobanApplicationError(
          'Cannot execute upgrade without new WASM bytecode: pass UpgradePlan.newWasm (or newWasm to createUpgradePlan).',
        );
      }
      this.logger.log('Deploying new contract version...');
      const upload = await this.deploymentService.uploadWasm(plan.newWasm);
      transactionHashes.push(upload.transactionHash);
      const instance = await this.deploymentService.instantiate({
        wasmHash: upload.wasmHash,
        salt: plan.salt,
      });
      transactionHashes.push(instance.transactionHash);
      if (!instance.contractId) {
        throw new SorobanApplicationError(
          'Contract instantiation succeeded but returned no contract ID',
        );
      }
      deployedContractId = instance.contractId;
      if (deployedContractId !== plan.newContractId) {
        this.logger.warn(
          `Deployed contract ${deployedContractId} differs from plan ${plan.newContractId}; using the deployed ID`,
        );
        // Keep the ABI usable under the real deployed ID.
        if (plan.newSpecXdr && plan.newSpecXdr.length > 0) {
          this.abiService.registerFromXdr(deployedContractId, plan.newSpecXdr);
        }
      }
      migrationsExecuted.push('deploy-new-contract');

      // Step 2: Migrate state from old to new contract. importContractState
      // throws an explicit unsupported-migration error for non-empty state,
      // surfacing as success:false here.
      await this.migrateContractState(
        plan.currentContractId,
        deployedContractId,
      );
      migrationsExecuted.push('migrate-state');
      this.logger.log('State migration completed');

      // Step 3: Persist the registry update, deactivating the previous contract.
      if (!this.registry.isRegistered(deployedContractId)) {
        const current = this.registry.getMetadata(plan.currentContractId);
        this.registry.register({
          contractId: deployedContractId,
          type: current.type,
          version: plan.newVersion,
          capabilities: [...current.capabilities],
          deployedAt: Date.now(),
          isActive: false,
          previousVersions: [current.version],
        });
      }
      this.registry.setActive(deployedContractId);
      migrationsExecuted.push('update-registry');
      this.logger.log(
        `Marked ${plan.currentContractId} as inactive, ${deployedContractId} is now active`,
      );
    } catch (error) {
      errors.push((error as Error).message);
      this.logger.error(`Upgrade failed: ${(error as Error).message}`);
    }

    const success = errors.length === 0;

    this.logger.log(
      `Upgrade ${success ? 'completed successfully' : 'failed'} for ${plan.currentContractId} -> ${deployedContractId}`,
    );

    return {
      success,
      previousContractId: plan.currentContractId,
      newContractId: deployedContractId,
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
   * Computes sourceAccountFunded / sufficientPermissions from chain state
   * instead of hardcoded values. Requires a configured signer; without one
   * both checks are false so the plan fails loudly.
   */
  private async checkSourceAccount(): Promise<{
    funded: boolean;
    permitted: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    if (!this.client) {
      warnings.push('Soroban client unavailable; cannot verify funding/permissions');
      return { funded: false, permitted: false, warnings };
    }
    let signerPublicKey: string;
    try {
      signerPublicKey = this.client.requireSigner().publicKey();
    } catch (error) {
      warnings.push(`No server signer: ${(error as Error).message}`);
      return { funded: false, permitted: false, warnings };
    }
    let account: any;
    try {
      account = await this.client.getAccount(signerPublicKey);
    } catch (error) {
      warnings.push(
        `Source account ${signerPublicKey} could not be loaded: ${(error as Error).message}`,
      );
      return { funded: false, permitted: false, warnings };
    }
    const minimumXlm =
      this.configService?.get<number>('soroban.upgradeMinXlmBalance') ?? 5;
    const balance = this.extractXlmBalance(account);
    const funded = balance !== null && Number.isFinite(balance) && balance >= minimumXlm;
    if (!funded) {
      warnings.push(
        `Source account ${signerPublicKey} XLM balance ${balance ?? 'unknown'} is below minimum ${minimumXlm}`,
      );
    }
    const weight = this.extractSignerWeight(account, signerPublicKey);
    const required = this.extractHighThreshold(account);
    const permitted = weight !== null && weight >= required;
    if (!permitted) {
      warnings.push(
        `Signer ${signerPublicKey} weight ${weight ?? 'unknown'} is below required threshold ${required}`,
      );
    }
    return { funded, permitted, warnings };
  }

  /** Best-effort XLM balance from a Horizon/RPC account shape. */
  private extractXlmBalance(account: any): number | null {
    const balances: any[] = Array.isArray(account?.balances)
      ? account.balances
      : [];
    for (const balance of balances) {
      if (!balance || typeof balance !== 'object') {
        continue;
      }
      const isNative =
        balance.asset_type === 'native' ||
        balance.asset_code === 'XLM' ||
        balance.assetCode === 'XLM';
      if (!isNative) {
        continue;
      }
      const raw = balance.balance ?? balance.amount ?? '0';
      const parsed = Number(String(raw));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  /** Best-effort signer weight for `publicKey` from an account shape. */
  private extractSignerWeight(account: any, publicKey: string): number | null {
    const signers: any[] = Array.isArray(account?.signers)
      ? account.signers
      : [];
    for (const signer of signers) {
      if (!signer || typeof signer !== 'object') {
        continue;
      }
      const key = signer.key ?? signer.publicKey ?? signer.public_key;
      if (key !== publicKey) {
        continue;
      }
      const raw = signer.weight ?? signer.keyWeight ?? signer.key_weight;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  /** Best-effort high threshold from an account shape (defaults to 1). */
  private extractHighThreshold(account: any): number {
    const thresholds = account?.thresholds ?? {};
    const raw =
      thresholds.high_threshold ?? thresholds.high ?? thresholds.highThreshold;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
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

    // Import them into the new contract. Non-empty state currently throws
    // an explicit unsupported-migration error (see ContractStateService),
    // so the upgrade returns success:false instead of false success.
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
    // setActive deactivates the new version in the same call.
    this.registry.setActive(previousContractId);
    this.logger.log(
      `Rolled back to previous contract ${previousContractId}, deactivated ${newContractId}`,
    );
  }
}
