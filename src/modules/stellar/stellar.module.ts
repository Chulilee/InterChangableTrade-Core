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
    // Soroban smart-contract integration module.
    SorobanClientService,
    ContractAbiService,
    ContractInvocationService,
    ContractDeploymentService,
    ContractStateService,
    ContractEventIndexerService,
  ],
  exports: [
    StellarService,
    SorobanService,
    StellarApiGatewayService,
    StellarConnectionPoolService,
    // Soroban services, for consumers that invoke contracts directly.
    SorobanClientService,
    ContractAbiService,
    ContractInvocationService,
    ContractDeploymentService,
    ContractStateService,
    ContractEventIndexerService,
  ],
})
export class StellarModule {}