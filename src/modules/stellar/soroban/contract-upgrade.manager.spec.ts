import { ContractUpgradeManager } from './contract-upgrade.manager';
import { ContractRegistryService } from './contract-registry.service';
import { SorobanApplicationError } from './soroban.errors';

const OLD = 'COLD';
const NEW = 'CNEW';
const SIGNER = 'GSIGNER';

function fundedAccount() {
  return {
    balances: [{ asset_type: 'native', balance: '10.0000000' }],
    signers: [{ key: SIGNER, weight: 1, type: 'ed25519_public_key' }],
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  };
}

function poorAccount() {
  return {
    balances: [{ asset_type: 'native', balance: '1.0000000' }],
    signers: [{ key: SIGNER, weight: 1, type: 'ed25519_public_key' }],
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
  };
}

describe('ContractUpgradeManager (issue #89)', () => {
  const makeManager = (account: unknown = fundedAccount()) => {
    const abiService = { registerFromXdr: jest.fn() };
    const config = {
      get: (key: string) =>
        key === 'soroban.upgradeMinXlmBalance' ? 5 : undefined,
    };
    const registry = new ContractRegistryService(
      abiService as never,
      config as never,
    );
    registry.register({
      contractId: OLD,
      type: 'swap-pool',
      version: '1.0.0',
      capabilities: ['swap'],
      deployedAt: 1,
      isActive: true,
    });
    const deploymentService = {
      uploadWasm: jest.fn(async () => ({
        wasmHash: 'aa'.repeat(32),
        transactionHash: 'upload-hash',
      })),
      instantiate: jest.fn(async () => ({
        wasmHash: 'aa'.repeat(32),
        contractId: NEW,
        transactionHash: 'instantiate-hash',
      })),
    };
    const stateService = {
      listStorageKeys: jest.fn(async () => []),
      exportContractState: jest.fn(async () => ({})),
      importContractState: jest.fn(async () => {}),
    };
    const client = {
      requireSigner: jest.fn(() => ({ publicKey: () => SIGNER })),
      getAccount: jest.fn(async () => account),
    };
    const manager = new ContractUpgradeManager(
      registry,
      deploymentService as never,
      stateService as never,
      abiService as never,
      client as never,
      config as never,
    );
    return {
      manager,
      registry,
      deploymentService,
      stateService,
      abiService,
      client,
      config,
    };
  };

  const newMetadata = () => ({
    contractId: NEW,
    type: 'swap-pool',
    version: '1.1.0',
    capabilities: ['swap', 'flash_loan'],
    deployedAt: Date.now(),
    isActive: false,
  });

  it('createUpgradePlan computes funding/permission checks (not hardcoded)', async () => {
    const { manager } = makeManager(fundedAccount());

    const plan = await manager.createUpgradePlan(OLD, newMetadata(), ['spec']);

    expect(plan.preflightChecks.sourceAccountFunded).toBe(true);
    expect(plan.preflightChecks.sufficientPermissions).toBe(true);
    expect(plan.preflightChecks.abiCompatible).toBe(true);
    expect(plan.canUpgrade).toBe(true);
  });

  it('createUpgradePlan fails loudly when the source account is underfunded', async () => {
    const { manager } = makeManager(poorAccount());

    const plan = await manager.createUpgradePlan(OLD, newMetadata(), ['spec']);

    expect(plan.preflightChecks.sourceAccountFunded).toBe(false);
    expect(plan.canUpgrade).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/below minimum/i);
  });

  it('executeUpgrade deploys for real, migrates, and deactivates the old version', async () => {
    const ctx = makeManager();
    ctx.registry.register(newMetadata());
    const plan = await ctx.manager.createUpgradePlan(
      OLD,
      newMetadata(),
      ['spec'],
      Buffer.from('wasm-bytes'),
    );
    expect(plan.canUpgrade).toBe(true);

    const result = await ctx.manager.executeUpgrade(plan);

    expect(ctx.deploymentService.uploadWasm).toHaveBeenCalledWith(
      Buffer.from('wasm-bytes'),
    );
    expect(ctx.deploymentService.instantiate).toHaveBeenCalled();
    expect(ctx.stateService.exportContractState).toHaveBeenCalledWith(OLD);
    expect(ctx.stateService.importContractState).toHaveBeenCalledWith(NEW, {});
    expect(result.success).toBe(true);
    expect(result.newContractId).toBe(NEW);
    expect(result.transactionHashes).toEqual(['upload-hash', 'instantiate-hash']);
    expect(result.migrationsExecuted).toEqual([
      'deploy-new-contract',
      'migrate-state',
      'update-registry',
    ]);
    expect(ctx.registry.getMetadata(OLD).isActive).toBe(false);
    expect(ctx.registry.getMetadata(NEW).isActive).toBe(true);
  });

  it('executeUpgrade without WASM returns success:false instead of false success', async () => {
    const ctx = makeManager();
    const plan = await ctx.manager.createUpgradePlan(OLD, newMetadata(), [
      'spec',
    ]);
    // No WASM supplied: execution must not pretend to deploy.
    const result = await ctx.manager.executeUpgrade(plan);

    expect(ctx.deploymentService.uploadWasm).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.migrationsExecuted).not.toContain('deploy-new-contract');
    expect(result.errors.join(' ')).toMatch(/WASM/i);
    expect(ctx.registry.getMetadata(OLD).isActive).toBe(true);
  });

  it('executeUpgrade fails loudly on unsupported state migration', async () => {
    const ctx = makeManager();
    ctx.registry.register(newMetadata());
    ctx.stateService.exportContractState.mockResolvedValue({ pool: 100 });
    ctx.stateService.importContractState.mockRejectedValue(
      new SorobanApplicationError(
        'State migration is not supported for contract CNEW: 1 storage entries cannot be migrated generically.',
      ),
    );
    const plan = await ctx.manager.createUpgradePlan(
      OLD,
      newMetadata(),
      ['spec'],
      Buffer.from('wasm-bytes'),
    );

    const result = await ctx.manager.executeUpgrade(plan);

    expect(result.success).toBe(false);
    expect(result.migrationsExecuted).toContain('deploy-new-contract');
    expect(result.migrationsExecuted).not.toContain('migrate-state');
    expect(result.errors.join(' ')).toMatch(/State migration is not supported/i);
    // Registry must not switch on a failed migration.
    expect(ctx.registry.getMetadata(OLD).isActive).toBe(true);
    expect(ctx.registry.getMetadata(NEW).isActive).toBe(false);
  });

  it('executeUpgrade returns success:false when deployment fails', async () => {
    const ctx = makeManager();
    ctx.registry.register(newMetadata());
    ctx.deploymentService.uploadWasm.mockRejectedValue(
      new Error('network down'),
    );
    const plan = await ctx.manager.createUpgradePlan(
      OLD,
      newMetadata(),
      ['spec'],
      Buffer.from('wasm-bytes'),
    );

    const result = await ctx.manager.executeUpgrade(plan);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('network down');
    expect(result.migrationsExecuted).toEqual([]);
    expect(ctx.registry.getMetadata(OLD).isActive).toBe(true);
  });
});
