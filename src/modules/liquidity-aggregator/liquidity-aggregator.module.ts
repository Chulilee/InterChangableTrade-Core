import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiquidityPool } from './entities/liquidity-pool.entity';
import { PoolSnapshot } from './entities/pool-snapshot.entity';
import { RouteCache } from './entities/route-cache.entity';
import { ArbitrageOpportunity } from './entities/arbitrage-opportunity.entity';
import { PoolRegistryService } from './services/pool-registry.service';
import { PriceOracleService } from './services/price-oracle.service';
import { RouteGraphService } from './services/route-graph.service';
import { PriceImpactService } from './services/price-impact.service';
import { MultiRouteSplitterService } from './services/multi-route-splitter.service';
import { LiquidityMonitoringService } from './services/liquidity-monitoring.service';
import { RouteExecutionSimulatorService } from './services/route-execution-simulator.service';
import { LiquidityAggregatorService } from './services/liquidity-aggregator.service';
import { LiquidityAggregatorController } from './liquidity-aggregator.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiquidityPool,
      PoolSnapshot,
      RouteCache,
      ArbitrageOpportunity,
    ]),
  ],
  controllers: [LiquidityAggregatorController],
  providers: [
    PoolRegistryService,
    PriceOracleService,
    RouteGraphService,
    PriceImpactService,
    MultiRouteSplitterService,
    LiquidityMonitoringService,
    RouteExecutionSimulatorService,
    LiquidityAggregatorService,
  ],
  exports: [
    LiquidityAggregatorService,
    PoolRegistryService,
    PriceOracleService,
    RouteGraphService,
    PriceImpactService,
    MultiRouteSplitterService,
  ],
})
export class LiquidityAggregatorModule {}
