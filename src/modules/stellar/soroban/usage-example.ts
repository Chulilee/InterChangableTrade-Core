/**
 * Example usage of the Soroban Smart Contract Abstraction Layer
 * This demonstrates how developers would interact with the new abstraction
 * layer to work with contracts in a type-safe, simplified way.
 */

import {
  ContractRegistryService,
  ContractMetadata,
} from './contract-registry.service';
import { SwapPoolContract } from './contracts/swap-pool.contract';
import {
  MultisigTransactionBuilder,
  BatchedInvocation,
} from './multisig-transaction.builder';
import { ContractUpgradeManager } from './contract-upgrade.manager';

/**
 * Example: Register and use a swap pool contract
 */
async function exampleSwapPoolUsage(
  registry: ContractRegistryService,
  swapPoolContract: SwapPoolContract,
) {
  // 1. Register a new swap pool contract in the registry
  const poolMetadata: ContractMetadata = {
    contractId: 'CA3D5...', // Replace with actual contract ID
    type: 'swap-pool',
    version: '1.0.0',
    capabilities: ['swap', 'add_liquidity', 'remove_liquidity', 'quote'],
    deployedAt: Date.now(),
    isActive: true,
    metadata: {
      tokenA: 'USDTC...',
      tokenB: 'XLM...',
      fee: '0.003', // 0.3% fee
    },
  };

  // Register with its ABI (spec entries from contract build)
  registry.register(poolMetadata, ['AAAA...', 'AAAA...']); // ABI spec entries

  // 2. Initialize the contract instance
  swapPoolContract.initialize(poolMetadata.contractId);

  // 3. Use type-safe contract methods
  const reserves = await swapPoolContract.getReserves();
  console.log('Pool reserves:', reserves.result);

  const quote = await swapPoolContract.quoteSwap('1000000', 'USDTC');
  console.log('Swap quote:', quote.result);

  // Execute a swap
  const swapResult = await swapPoolContract.swap(
    '1000000',
    '990000', // min amount out (slippage protection)
    'USDTC',
    'GDEST...', // recipient
  );
  console.log('Swap executed:', swapResult.transactionHash);
}

/**
 * Example: Build and execute a multi-signature transaction
 */
async function exampleMultisigUsage(
  multisigBuilder: MultisigTransactionBuilder,
) {
  // Batch multiple swaps into one transaction
  const invocations: BatchedInvocation[] = [
    {
      contractId: 'CA3D5...',
      method: 'swap',
      args: { amount_in: '1000000', token_in: 'USDTC', recipient: 'GUSER1...' },
    },
    {
      contractId: 'CB2E4...',
      method: 'swap',
      args: { amount_in: '500000', token_in: 'XLM', recipient: 'GUSER2...' },
    },
  ];

  // Configure multi-sig requirements: 2-of-3 signing
  const multisigTx = await multisigBuilder.buildTransaction(
    invocations,
    {
      threshold: 2,
      signers: [
        { publicKey: 'GKEY1...', signed: false, weight: 1 },
        { publicKey: 'GKEY2...', signed: false, weight: 1 },
        { publicKey: 'GKEY3...', signed: false, weight: 1 },
      ],
      timeout: 300,
      mevProtection: true, // Enable MEV protection
    },
    'GSOURCE...',
  );

  // Add signatures from signers
  const afterFirstSig = multisigBuilder.addSignature(
    multisigTx,
    'GKEY1...',
    'sig1_abcdef...', // Actual signature from the signer
  );

  const afterSecondSig = multisigBuilder.addSignature(
    afterFirstSig,
    'GKEY2...',
    'sig2_xyz123...', // Second signature
  );

  // Now the transaction has enough signatures and can be submitted
  if (afterSecondSig.isReadyToSubmit) {
    const result = await multisigBuilder.submitTransaction(afterSecondSig);
    console.log('Multi-sig tx submitted:', result.txHash);
  }
}

/**
 * Example: Upgrade a contract to a new version
 */
async function exampleContractUpgrade(
  upgradeManager: ContractUpgradeManager,
  registry: ContractRegistryService,
) {
  // Current active contract we want to upgrade
  const currentPool = registry.getActiveContract('swap-pool')!;

  // New version metadata
  const newPoolMetadata: ContractMetadata = {
    contractId: 'CNEWPOOL...',
    type: 'swap-pool',
    version: '1.1.0', // New version with improved features
    capabilities: [
      'swap',
      'add_liquidity',
      'remove_liquidity',
      'quote',
      'flash_loan',
    ],
    deployedAt: Date.now(),
    isActive: false,
    previousVersions: [currentPool.version],
    metadata: {
      tokenA: 'USDTC...',
      tokenB: 'XLM...',
      fee: '0.0025', // Reduced fee
      newFeature: 'flash_loans_supported',
    },
  };

  // Create an upgrade plan to check compatibility
  const plan = await upgradeManager.createUpgradePlan(
    currentPool.contractId,
    newPoolMetadata,
    ['AAAA...', 'AAAA...'], // New ABI spec entries
  );

  if (plan.canUpgrade) {
    // Execute the upgrade
    const result = await upgradeManager.executeUpgrade(plan);
    if (result.success) {
      console.log(
        'Upgrade successful! New contract active:',
        result.newContractId,
      );
    }
  } else {
    console.warn('Upgrade not possible:', plan.warnings);
  }
}

export { exampleSwapPoolUsage, exampleMultisigUsage, exampleContractUpgrade };
