import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LiquidityAggregatorService } from './services/liquidity-aggregator.service';
import {
  RegisterPoolDto,
  QueryPoolsDto,
  RefreshPoolDto,
  GetPriceDto,
  GetBatchPricesDto,
  FindRouteDto,
  FindMultiRouteDto,
  SplitRouteDto,
  EstimatePriceImpactDto,
  SimulateRouteDto,
} from './dto/index';

@ApiTags('liquidity-aggregator')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('liquidity')
export class LiquidityAggregatorController {
  constructor(
    private readonly aggregatorService: LiquidityAggregatorService,
  ) {}

  // ─── Pool Registry ──────────────────────────────────────────────────────

  @Post('pools')
  @ApiOperation({ summary: 'Register a new liquidity pool' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Pool registered successfully',
  })
  @HttpCode(HttpStatus.CREATED)
  async registerPool(@Body() dto: RegisterPoolDto) {
    return this.aggregatorService.registerPool(dto);
  }

  @Get('pools')
  @ApiOperation({ summary: 'List all registered liquidity pools' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Pools retrieved' })
  async getPools(@Query() query: QueryPoolsDto) {
    return this.aggregatorService.getPools(query);
  }

  @Get('pools/:id')
  @ApiOperation({ summary: 'Get a specific pool by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Pool details' })
  async getPool(@Param('id') id: string) {
    return this.aggregatorService.getPool(id);
  }

  @Post('pools/refresh')
  @ApiOperation({ summary: 'Refresh pool TVL and volume data from on-chain' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Refresh triggered' })
  async refreshPools(@Body() dto: RefreshPoolDto) {
    return this.aggregatorService.refreshPools(dto);
  }

  // ─── Price Oracle ────────────────────────────────────────────────────────

  @Get('price')
  @ApiOperation({
    summary: 'Get volume-weighted aggregated price for a token pair',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Aggregated price' })
  async getPrice(@Query() dto: GetPriceDto) {
    return this.aggregatorService.getPrice(dto);
  }

  @Post('price/batch')
  @ApiOperation({ summary: 'Get prices for multiple token pairs at once' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Batch prices' })
  @HttpCode(HttpStatus.OK)
  async getBatchPrices(@Body() dto: GetBatchPricesDto) {
    return this.aggregatorService.getBatchPrices(dto);
  }

  // ─── Route Finding ──────────────────────────────────────────────────────

  @Post('routes/best')
  @ApiOperation({
    summary: 'Find the optimal swap route for a token pair',
    description:
      'Uses modified Dijkstra\'s algorithm considering price impact, gas fees, slippage, and pool liquidity depth. Target: <100ms response.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Best route with simulation' })
  @HttpCode(HttpStatus.OK)
  async findBestRoute(@Body() dto: FindRouteDto) {
    return this.aggregatorService.findBestRoute(dto);
  }

  @Post('routes/alternatives')
  @ApiOperation({
    summary: 'Find multiple alternative routes ranked by quality',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alternative routes with simulations',
  })
  @HttpCode(HttpStatus.OK)
  async findMultipleRoutes(@Body() dto: FindMultiRouteDto) {
    return this.aggregatorService.findMultipleRoutes(dto);
  }

  @Post('routes/split')
  @ApiOperation({
    summary: 'Split an order across multiple pools for better execution',
    description:
      'Automatically determines optimal allocation across pools to minimize price impact.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Optimal split allocation' })
  @HttpCode(HttpStatus.OK)
  async splitRoute(@Body() dto: SplitRouteDto) {
    return this.aggregatorService.splitRoute(dto);
  }

  // ─── Price Impact ────────────────────────────────────────────────────────

  @Post('price-impact')
  @ApiOperation({
    summary: 'Estimate price impact for a given order size',
    description:
      'Predicts price movement across pools. Target: 95%+ accuracy.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Price impact estimates' })
  @HttpCode(HttpStatus.OK)
  async estimatePriceImpact(@Body() dto: EstimatePriceImpactDto) {
    return this.aggregatorService.estimatePriceImpact(dto);
  }

  // ─── Simulation ──────────────────────────────────────────────────────────

  @Post('simulate')
  @ApiOperation({
    summary: 'Dry-run a swap route to validate feasibility',
    description:
      'Simulates execution against current pool state without committing.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Simulation results' })
  @HttpCode(HttpStatus.OK)
  async simulateRoute(@Body() dto: SimulateRouteDto) {
    return this.aggregatorService.simulateRoute(dto);
  }

  // ─── Arbitrage & Monitoring ──────────────────────────────────────────────

  @Get('arbitrage')
  @ApiOperation({
    summary: 'Scan for arbitrage opportunities across pools',
  })
  @ApiQuery({ name: 'minSpread', required: false, type: Number })
  @ApiResponse({ status: HttpStatus.OK, description: 'Arbitrage scan results' })
  async scanArbitrage(
    @Query('minSpread') minSpread?: number,
  ) {
    return this.aggregatorService.scanArbitrage(minSpread ?? 0.1);
  }

  @Get('arbitrage/active')
  @ApiOperation({ summary: 'Get active (non-expired) arbitrage opportunities' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active arbitrage opportunities',
  })
  async getActiveArbitrage(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.aggregatorService.getActiveArbitrage(
      page ?? 1,
      limit ?? 20,
    );
  }

  @Get('monitoring/health')
  @ApiOperation({
    summary: 'Scan pool health and return alerts on imbalances',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Pool health alerts' })
  async scanPoolHealth() {
    return this.aggregatorService.scanPoolHealth();
  }

  @Get('system/health')
  @ApiOperation({
    summary: 'Full system health check for the liquidity aggregator',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'System health status' })
  async getSystemHealth() {
    return this.aggregatorService.getSystemHealth();
  }
}
