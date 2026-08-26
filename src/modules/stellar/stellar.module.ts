import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { SorobanService } from './soroban.service';
import { StellarController } from './stellar.controller';
import { StellarConnectionPoolService } from './gateway/stellar-connection-pool.service';
import { StellarRateLimiterService } from './gateway/stellar-rate-limiter.service';
import { StellarRequestQueueService } from './gateway/stellar-request-queue.service';
import { StellarApiGatewayService } from './gateway/stellar-api-gateway.service';
import { StellarGatewayController } from './gateway/stellar-gateway.controller';
import { SorobanClientService } from './soroban/soroban-client.service';
import { ContractAbiService } from './soroban/contract-abi.service';
import { ContractInvocationService } from './soroban/contract-invocation.service';
import { ContractDeploymentService } from './soroban/contract-deployment.service';
import { ContractStateService } from './soroban/contract-state.service';
import { ContractEventIndexerService } from './soroban/contract-event-indexer.service';
import { SorobanContractController } from './soroban/soroban-contract.controller';
// New abstraction layer services
import { ContractRegistryService } from './soroban/contract-registry.service';
import { MultisigTransactionBuilder } from './soroban/multisig-transaction.builder';
import { ContractUpgradeManager } from './soroban/contract-upgrade.manager';
import { GasOptimizationEngine } from './soroban/gas-optimizer.service';
import { ContractEventDecoder } from './soroban/event-decoder.service';
// Example contract implementations
import { SwapPoolContract } from './soroban/contracts/swap-pool.contract';

@Module({
  controllers: [
    StellarController,
    StellarGatewayController,
    SorobanContractController,
  ],
  providers: [
    StellarService,
    SorobanService,
    StellarConnectionPoolService,
    StellarRateLimiterService,
    StellarRequestQueueService,
    StellarApiGatewayService,
    // Base Soroban services
    SorobanClientService,
    ContractAbiService,
    ContractInvocationService,
    ContractDeploymentService,
    ContractStateService,
    ContractEventIndexerService,
    // New Soroban abstraction layer services
    ContractRegistryService,
    MultisigTransactionBuilder,
    ContractUpgradeManager,
    GasOptimizationEngine,
    ContractEventDecoder,
    // Example contract implementations
    SwapPoolContract,
  ],
  exports: [
    StellarService,
    SorobanService,
    StellarApiGatewayService,
    StellarConnectionPoolService,
    // Base Soroban services
    SorobanClientService,
    ContractAbiService,
    ContractInvocationService,
    ContractDeploymentService,
    ContractStateService,
    ContractEventIndexerService,
    // Export abstraction layer services for external use
    ContractRegistryService,
    MultisigTransactionBuilder,
    ContractUpgradeManager,
    GasOptimizationEngine,
    ContractEventDecoder,
    // Export contract implementations
    SwapPoolContract,
  ],
})
export class StellarModule {}
