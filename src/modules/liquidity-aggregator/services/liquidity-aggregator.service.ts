import { Injectable, Logger } from '@nestjs/common';
import { PoolRegistryService } from './pool-registry.service';
import { PriceOracleService, AggregatedPrice } from './price-oracle.service';
import { RouteGraphService, RouteResult } from './route-graph.service';
import {
  PriceImpactService,
  MultiPoolImpactComparison,
} from './price-impact.service';
import {
  MultiRouteSplitterService,
  SplitRouteResult,
} from './multi-route-splitter.service';
import {
  LiquidityMonitoringService,
  PoolAlert,
  ArbitrageScanResult,
} from './liquidity-monitoring.service';
import {
  RouteExecutionSimulatorService,
  SimulationResult,
} from './route-execution-simulator.service';
import {
  FindRouteDto,
  FindMultiRouteDto,
  SplitRouteDto,
  EstimatePriceImpactDto,
  GetPriceDto,
  GetBatchPricesDto,
  SimulateRouteDto,
  QueryArbitrageDto,
  RegisterPoolDto,
  QueryPoolsDto,
  RefreshPoolDto,
} from '../dto/index';
import { LiquidityPool } from '../entities/liquidity-pool.entity';
import { PaginatedResultDto } from '@app/common';

/**
 * Top-level orchestrator for the liquidity aggregation engine. Delegates
 * to specialized services and provides a unified API surface for the
 * controller layer.
 */
@Injectable()
export class LiquidityAggregatorService {
  private readonly logger = new Logger(LiquidityAggregatorService.name);

  constructor(
    private readonly poolRegistry: PoolRegistryService,
    private readonly priceOracle: PriceOracleService,
    private readonly routeGraph: RouteGraphService,
    private readonly priceImpact: PriceImpactService,
    private readonly multiRouteSplitter: MultiRouteSplitterService,
    private readonly monitoring: LiquidityMonitoringService,
    private readonly simulator: RouteExecutionSimulatorService,
  ) {}

  // ─── Pool Registry ──────────────────────────────────────────────────────

  async registerPool(dto: RegisterPoolDto): Promise<LiquidityPool> {
    return this.poolRegistry.register(dto);
  }

  async getPools(
    query: QueryPoolsDto,
  ): Promise<PaginatedResultDto<LiquidityPool>> {
    return this.poolRegistry.findAll(query);
  }

  async getPool(id: string): Promise<LiquidityPool> {
    return this.poolRegistry.findById(id);
  }

  async refreshPools(dto: RefreshPoolDto): Promise<{ refreshed: number }> {
    // In production, this would trigger on-chain data fetching via the
    // Stellar service. For now it logs the request.
    this.logger.log(
      `Pool refresh requested${dto.poolId ? ` for pool ${dto.poolId}` : ' (all active)'}`,
    );
    return { refreshed: 0 };
  }

  // ─── Price Oracle ────────────────────────────────────────────────────────

  async getPrice(dto: GetPriceDto): Promise<AggregatedPrice> {
    return this.priceOracle.getAggregatedPrice(
      dto.tokenIn,
      dto.tokenInIssuer ?? null,
      dto.tokenOut,
      dto.tokenOutIssuer ?? null,
    );
  }

  async getBatchPrices(dto: GetBatchPricesDto): Promise<AggregatedPrice[]> {
    return this.priceOracle.getBatchPrices(dto.pairs);
  }

  // ─── Route Finding ──────────────────────────────────────────────────────

  /**
   * Find the single best route for a swap.
   * Target: < 100ms response time.
   */
  async findBestRoute(dto: FindRouteDto): Promise<{
    route: RouteResult;
    simulation: SimulationResult;
  }> {
    const startTime = Date.now();

    const [routes] = await Promise.all([
      this.routeGraph.findOptimalRoutes(
        dto.tokenIn,
        dto.tokenOut,
        dto.amountIn,
        dto.maxHops,
        1,
      ),
    ]);

    if (routes.length === 0) {
      throw new Error(
        `No route found from ${dto.tokenIn} to ${dto.tokenOut}`,
      );
    }

    const route = routes[0];

    // Simulate the route to validate
    const simulation = await this.simulator.simulateRoute(
      route.poolPath,
      dto.amountIn,
    );

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Route found in ${elapsed}ms for ${dto.amountIn} ${dto.tokenIn} → ${dto.tokenOut}`,
    );

    if (elapsed > 100) {
      this.logger.warn(`Route finding exceeded 100ms target: ${elapsed}ms`);
    }

    return { route, simulation };
  }

  /**
   * Find multiple alternative routes, ranked by quality.
   */
  async findMultipleRoutes(dto: FindMultiRouteDto): Promise<{
    routes: RouteResult[];
    simulations: SimulationResult[];
  }> {
    const routes = await this.routeGraph.findOptimalRoutes(
      dto.tokenIn,
      dto.tokenOut,
      dto.amountIn,
      dto.maxHops,
      dto.topN,
    );

    const simulations = await Promise.all(
      routes.map((r) =>
        this.simulator.simulateRoute(r.poolPath, dto.amountIn),
      ),
    );

    return { routes, simulations };
  }

  /**
   * Split an order across multiple pools for better execution.
   */
  async splitRoute(dto: SplitRouteDto): Promise<SplitRouteResult> {
    return this.multiRouteSplitter.findOptimalSplit(
      dto.tokenIn,
      dto.tokenInIssuer ?? null,
      dto.tokenOut,
      dto.tokenOutIssuer ?? null,
      dto.amountIn,
      dto.numSplits ?? 3,
    );
  }

  // ─── Price Impact ────────────────────────────────────────────────────────

  async estimatePriceImpact(
    dto: EstimatePriceImpactDto,
  ): Promise<MultiPoolImpactComparison> {
    return this.priceImpact.estimatePriceImpact(
      dto.tokenIn,
      dto.tokenInIssuer ?? null,
      dto.tokenOut,
      dto.tokenOutIssuer ?? null,
      dto.amountIn,
      dto.poolId,
    );
  }

  // ─── Simulation ──────────────────────────────────────────────────────────

  async simulateRoute(dto: SimulateRouteDto): Promise<SimulationResult> {
    return this.simulator.simulateRoute(
      dto.poolPath,
      dto.amountIn,
      dto.minAmountOut,
    );
  }

  // ─── Arbitrage & Monitoring ──────────────────────────────────────────────

  async scanArbitrage(
    minSpreadPercent = 0.1,
  ): Promise<ArbitrageScanResult> {
    return this.monitoring.scanArbitrage(minSpreadPercent);
  }

  async getActiveArbitrage(
    page = 1,
    limit = 20,
  ): Promise<{ data: import('../entities/arbitrage-opportunity.entity').ArbitrageOpportunity[]; total: number }> {
    return this.monitoring.getActiveOpportunities(page, limit);
  }

  async scanPoolHealth(): Promise<PoolAlert[]> {
    return this.monitoring.scanPoolHealth();
  }

  /**
   * Full system health check: pool count, graph size, arb opportunities,
   * and monitoring alerts.
   */
  async getSystemHealth(): Promise<{
    poolCount: number;
    activePoolCount: number;
    activeArbOpportunities: number;
    alerts: PoolAlert[];
    graphBuiltAt: Date | null;
  }> {
    const [pools, arbResult, alerts] = await Promise.all([
      this.poolRegistry.findActivePools(),
      this.monitoring.scanArbitrage(),
      this.monitoring.scanPoolHealth(),
    ]);

    return {
      poolCount: pools.length,
      activePoolCount: pools.length,
      activeArbOpportunities: arbResult.opportunitiesFound,
      alerts,
      graphBuiltAt: new Date(),
    };
  }
}
