import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { SorobanService } from './soroban.service';
import { StellarController } from './stellar.controller';
import { StellarConnectionPoolService } from './gateway/stellar-connection-pool.service';
import { StellarRateLimiterService } from './gateway/stellar-rate-limiter.service';
import { StellarRequestQueueService } from './gateway/stellar-request-queue.service';
import { StellarApiGatewayService } from './gateway/stellar-api-gateway.service';
import { StellarGatewayController } from './gateway/stellar-gateway.controller';

@Module({
  controllers: [StellarController, StellarGatewayController],
  providers: [
    StellarService, 
    SorobanService,
    StellarConnectionPoolService,
    StellarRateLimiterService,
    StellarRequestQueueService,
    StellarApiGatewayService,
  ],
  exports: [
    StellarService, 
    SorobanService,
    StellarApiGatewayService,
    StellarConnectionPoolService,
  ],
})
export class StellarModule {}