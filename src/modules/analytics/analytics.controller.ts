import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { MetricsCollectorService } from './services/metrics-collector.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { UserSegmentationService } from './services/user-segmentation.service';
import { MetricsQueryService } from './services/metrics-query.service';
import { MarketAnalyticsService } from './services/market-analytics.service';
import { TraderPerformanceService } from './services/trader-performance.service';
import { PoolAnalyticsService } from './services/pool-analytics.service';
import { FinancialReportingService } from './services/financial-reporting.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { ScheduledReportService } from './services/scheduled-report.service';
import { DataPipelineService } from './services/data-pipeline.service';
import { GenerateReportDto } from './dto/generate-report.dto';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { QueryMetricsDto } from './dto/query-metrics.dto';
import {
  GetTradingVolumeDto,
  GetPriceActionDto,
  GetPriceVolatilityDto,
  GetOrderFlowDto,
  GetMarketMakerPerformanceDto,
  GetLiquidityDepthDto,
} from './dto/market-analytics.dto';
import {
  GetTraderPerformanceDto,
  GetAllTradersPerformanceDto,
  GetUserRetentionDto,
  GetBehaviorPatternsDto,
} from './dto/trader-performance.dto';
import {
  GetPoolMetricsDto,
  GetLpReturnsDto,
  GetFeeCollectionAnalysisDto,
  GetTvlTrendsDto,
  ComparePoolsDto,
  GetPoolUtilizationDto,
} from './dto/pool-analytics.dto';
import {
  GetRevenueBreakdownDto,
  GetCostAnalysisDto,
  GetProfitabilityMetricsDto,
  GetForecastDataDto,
} from './dto/financial-reporting.dto';
import { DetectAnomaliesDto } from './dto/anomaly-detection.dto';
import {
  ScheduleReportDto,
  RunDataQualityCheckDto,
} from './dto/data-pipeline.dto';
import { MetricType } from './entities/analytics-metric.entity';
import * as fs from 'fs';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(
    private readonly metricsCollectorService: MetricsCollectorService,
    private readonly reportGeneratorService: ReportGeneratorService,
    private readonly userSegmentationService: UserSegmentationService,
    private readonly metricsQueryService: MetricsQueryService,
    private readonly marketAnalyticsService: MarketAnalyticsService,
    private readonly traderPerformanceService: TraderPerformanceService,
    private readonly poolAnalyticsService: PoolAnalyticsService,
    private readonly financialReportingService: FinancialReportingService,
    private readonly anomalyDetectionService: AnomalyDetectionService,
    private readonly scheduledReportService: ScheduledReportService,
    private readonly dataPipelineService: DataPipelineService,
  ) {}

  // ─── Existing Endpoints ─────────────────────────────────────────────────

  @Get('metrics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Query analytics metrics' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Metrics retrieved successfully' })
  async queryMetrics(@Query() queryDto: QueryMetricsDto) {
    return this.metricsQueryService.queryMetrics(queryDto);
  }

  @Get('timeseries/:metricType')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get time series data for a metric' })
  async getTimeSeries(
    @Param('metricType') metricType: MetricType,
    @Query('aggregation') aggregation: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('assetCode') assetCode?: string,
  ) {
    return this.metricsQueryService.getTimeSeriesData(
      metricType,
      aggregation as any,
      new Date(dateFrom),
      new Date(dateTo),
      assetCode,
    );
  }

  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get dashboard summary' })
  async getDashboardSummary() {
    return this.metricsQueryService.getDashboardSummary();
  }

  @Get('trends/:metricType')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get historical trends' })
  async getHistoricalTrends(
    @Param('metricType') metricType: MetricType,
    @Query('months') months: number = 12,
    @Query('assetCode') assetCode?: string,
  ) {
    return this.metricsQueryService.getHistoricalTrends(metricType, months, assetCode);
  }

  @Post('reports')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Generate a new report' })
  async generateReport(
    @CurrentUser() user: any,
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportGeneratorService.createReport(user.id, dto);
  }

  @Get('reports')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get all user reports' })
  async getUserReports(@CurrentUser() user: any) {
    return this.reportGeneratorService.getUserReports(user.id);
  }

  @Get('reports/:id')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get report details' })
  async getReport(@Param('id') id: string) {
    return this.reportGeneratorService.getReport(id);
  }

  @Get('reports/:id/download')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Download report file' })
  async downloadReport(@Param('id') id: string): Promise<StreamableFile> {
    const report = await this.reportGeneratorService.getReport(id);
    
    if (report.status !== 'completed' || !report.fileUrl || !fs.existsSync(report.fileUrl)) {
      throw new HttpException('Report file not available', HttpStatus.BAD_REQUEST);
    }

    const file = createReadStream(report.fileUrl);
    return new StreamableFile(file);
  }

  @Delete('reports/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a report' })
  async deleteReport(@Param('id') id: string) {
    await this.reportGeneratorService.deleteReport(id);
    return { success: true };
  }

  @Post('segments')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Create a new user segment' })
  async createSegment(
    @CurrentUser() user: any,
    @Body() dto: CreateSegmentDto,
  ) {
    return this.userSegmentationService.createSegment(user.id, dto);
  }

  @Get('segments')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get all segments' })
  async getAllSegments() {
    return this.userSegmentationService.getAllSegments();
  }

  @Get('segments/:id')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get segment details' })
  async getSegment(@Param('id') id: string) {
    return this.userSegmentationService.getSegmentById(id);
  }

  @Put('segments/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a segment' })
  async updateSegment(
    @Param('id') id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    return this.userSegmentationService.updateSegment(id, dto);
  }

  @Delete('segments/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a segment' })
  async deleteSegment(@Param('id') id: string) {
    await this.userSegmentationService.deleteSegment(id);
    return { success: true };
  }

  @Post('segments/:id/recalculate')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Force recalculate segment users' })
  async recalculateSegment(@Param('id') id: string) {
    const segment = await this.userSegmentationService.getSegmentById(id);
    await this.userSegmentationService.recalculateSegmentUsers(segment);
    return segment;
  }

  @Post('segments/:segmentId/users/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Add user to manual segment' })
  async addUserToSegment(
    @Param('segmentId') segmentId: string,
    @Param('userId') userId: string,
  ) {
    return this.userSegmentationService.addUserToManualSegment(segmentId, userId);
  }

  @Delete('segments/:segmentId/users/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove user from manual segment' })
  async removeUserFromSegment(
    @Param('segmentId') segmentId: string,
    @Param('userId') userId: string,
  ) {
    return this.userSegmentationService.removeUserFromManualSegment(segmentId, userId);
  }

  @Post('calculate/trade-metrics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Manually trigger trade metrics calculation' })
  async calculateTradeMetrics(
    @Body('dateFrom') dateFrom: string,
    @Body('dateTo') dateTo: string,
  ) {
    await this.metricsCollectorService.calculateTradeMetrics(
      new Date(dateFrom),
      new Date(dateTo),
    );
    return { success: true };
  }

  @Post('calculate/user-metrics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Manually trigger user metrics calculation' })
  async calculateUserMetrics(
    @Body('dateFrom') dateFrom: string,
    @Body('dateTo') dateTo: string,
  ) {
    await this.metricsCollectorService.calculateUserMetrics(
      new Date(dateFrom),
      new Date(dateTo),
    );
    return { success: true };
  }

  @Post('calculate/revenue-metrics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Manually trigger revenue metrics calculation' })
  async calculateRevenueMetrics(
    @Body('dateFrom') dateFrom: string,
    @Body('dateTo') dateTo: string,
  ) {
    await this.metricsCollectorService.calculateRevenueMetrics(
      new Date(dateFrom),
      new Date(dateTo),
    );
    return { success: true };
  }

  // ─── Market Analytics Endpoints ─────────────────────────────────────────

  @Get('market/volume/by-pair')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get trading volume by asset pair' })
  async getTradingVolumeByPair(@Query() dto: GetTradingVolumeDto) {
    return this.marketAnalyticsService.getTradingVolumeByPair(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.limit,
    );
  }

  @Get('market/volume/by-trader')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get trading volume by trader' })
  async getTradingVolumeByTrader(@Query() dto: GetTradingVolumeDto) {
    return this.marketAnalyticsService.getTradingVolumeByTrader(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.limit,
    );
  }

  @Get('market/price-action')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get OHLCV price action data' })
  async getPriceAction(@Query() dto: GetPriceActionDto) {
    return this.marketAnalyticsService.getPriceAction(
      dto.assetCode,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.aggregation,
    );
  }

  @Get('market/volatility')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get price volatility metrics' })
  async getPriceVolatility(@Query() dto: GetPriceVolatilityDto) {
    return this.marketAnalyticsService.getPriceVolatility(
      dto.assetCode,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.windowSize,
    );
  }

  @Get('market/order-flow')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get order flow analysis' })
  async getOrderFlow(@Query() dto: GetOrderFlowDto) {
    return this.marketAnalyticsService.getOrderFlow(
      dto.assetCode,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.aggregation,
    );
  }

  @Get('market/market-makers')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get market maker performance' })
  async getMarketMakerPerformance(@Query() dto: GetMarketMakerPerformanceDto) {
    return this.marketAnalyticsService.getMarketMakerPerformance(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.limit,
    );
  }

  @Get('market/liquidity-depth')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get liquidity depth summary' })
  async getLiquidityDepth(@Query() dto: GetLiquidityDepthDto) {
    return this.marketAnalyticsService.getLiquidityDepth(
      dto.assetCode,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  // ─── Trader Performance Endpoints ───────────────────────────────────────

  @Get('traders/:traderId/performance')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get trader performance metrics' })
  async getTraderPerformance(@Param() dto: GetTraderPerformanceDto) {
    return this.traderPerformanceService.getTraderPerformance(
      dto.traderId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('traders/performance')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get all traders performance' })
  async getAllTradersPerformance(@Query() dto: GetAllTradersPerformanceDto) {
    return this.traderPerformanceService.getAllTradersPerformance(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.limit,
    );
  }

  @Get('users/retention')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get user retention analysis' })
  async getUserRetention(@Query() dto: GetUserRetentionDto) {
    return this.traderPerformanceService.getUserRetention(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.intervalDays,
    );
  }

  @Get('traders/:traderId/behavior')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get trader behavior patterns' })
  async getBehaviorPatterns(@Param() dto: GetBehaviorPatternsDto) {
    return this.traderPerformanceService.getBehaviorPatterns(
      dto.traderId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  // ─── Pool Analytics Endpoints ───────────────────────────────────────────

  @Get('pools/:poolId/metrics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get pool metrics' })
  async getPoolMetrics(@Param() dto: GetPoolMetricsDto) {
    return this.poolAnalyticsService.getPoolMetrics(
      dto.poolId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('pools/:poolId/lp-returns')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get LP returns and impermanent loss' })
  async getLpReturns(@Query() dto: GetLpReturnsDto) {
    return this.poolAnalyticsService.getLpReturns(
      dto.lpId,
      dto.poolId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('pools/:poolId/fees')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get fee collection analysis' })
  async getFeeCollectionAnalysis(@Param('poolId') poolId: string, @Query() dto: GetFeeCollectionAnalysisDto) {
    return this.poolAnalyticsService.getFeeCollectionAnalysis(
      poolId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.aggregation,
    );
  }

  @Get('pools/:poolId/tvl')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get TVL trends' })
  async getTvlTrends(@Param('poolId') poolId: string, @Query() dto: GetTvlTrendsDto) {
    return this.poolAnalyticsService.getTvlTrends(
      poolId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      dto.aggregation,
    );
  }

  @Post('pools/compare')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Compare multiple pools' })
  async comparePools(@Body() dto: ComparePoolsDto) {
    return this.poolAnalyticsService.comparePools(
      dto.poolIds,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('pools/:poolId/utilization')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get pool utilization metrics' })
  async getPoolUtilization(@Param('poolId') poolId: string, @Query() dto: GetPoolUtilizationDto) {
    return this.poolAnalyticsService.getPoolUtilization(
      poolId,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  // ─── Financial Reporting Endpoints ──────────────────────────────────────

  @Get('financial/revenue')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get revenue breakdown' })
  async getRevenueBreakdown(@Query() dto: GetRevenueBreakdownDto) {
    return this.financialReportingService.getRevenueBreakdown(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('financial/costs')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get cost analysis' })
  async getCostAnalysis(@Query() dto: GetCostAnalysisDto) {
    return this.financialReportingService.getCostAnalysis(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('financial/profitability')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get profitability metrics' })
  async getProfitabilityMetrics(@Query() dto: GetProfitabilityMetricsDto) {
    return this.financialReportingService.getProfitabilityMetrics(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Get('financial/year-over-year')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get year-over-year performance' })
  async getYearOverYearPerformance() {
    return this.financialReportingService.getYearOverYearPerformance();
  }

  @Get('financial/forecast')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get forecast data' })
  async getForecastData(@Query() dto: GetForecastDataDto) {
    return this.financialReportingService.getForecastData(
      dto.metricType,
      dto.historicalMonths,
      dto.forecastMonths,
    );
  }

  // ─── Anomaly Detection Endpoints ────────────────────────────────────────

  @Post('anomalies/detect')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Detect anomalies in trading activity' })
  async detectAnomalies(@Body() dto: DetectAnomaliesDto) {
    return this.anomalyDetectionService.detectAnomalies(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
      {
        types: dto.types,
        minSeverity: dto.minSeverity,
        userId: dto.userId,
        assetCode: dto.assetCode,
      },
    );
  }

  @Get('anomalies/statistics')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get anomaly statistics' })
  async getAnomalyStatistics(@Query() dto: DetectAnomaliesDto) {
    return this.anomalyDetectionService.getAnomalyStatistics(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  // ─── Scheduled Reports Endpoints ────────────────────────────────────────

  @Post('reports/schedule')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Schedule a report' })
  async scheduleReport(@Body() dto: ScheduleReportDto) {
    return this.scheduledReportService.scheduleReport(dto.reportId, {
      frequency: dto.frequency,
      cronExpression: dto.cronExpression,
      recipients: dto.recipients,
      includeCharts: dto.includeCharts,
      includeSummary: dto.includeSummary,
      customParameters: dto.customParameters,
    });
  }

  @Get('reports/scheduled')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get all scheduled reports' })
  async getScheduledReports() {
    return this.scheduledReportService.getScheduledReports();
  }

  @Put('reports/:id/schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update report schedule' })
  async updateReportSchedule(
    @Param('id') id: string,
    @Body() dto: Partial<ScheduleReportDto>,
  ) {
    return this.scheduledReportService.updateSchedule(id, dto);
  }

  @Delete('reports/:id/schedule')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove report schedule' })
  async removeReportSchedule(@Param('id') id: string) {
    await this.scheduledReportService.removeSchedule(id);
    return { success: true };
  }

  @Get('reports/:id/deliveries')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get report delivery history' })
  async getReportDeliveries(@Param('id') id: string) {
    return this.scheduledReportService.getDeliveryHistory(id);
  }

  // ─── Data Pipeline Endpoints ────────────────────────────────────────────

  @Post('pipeline/etl')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start ETL pipeline job' })
  async startEtlJob(@Body() dto: any) {
    return this.dataPipelineService.startEtlJob(dto);
  }

  @Post('pipeline/backfill')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start backfill job' })
  async startBackfillJob(@Body() dto: any) {
    return this.dataPipelineService.startBackfillJob(dto);
  }

  @Post('pipeline/aggregation')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start aggregation job' })
  async startAggregationJob(@Body() dto: any) {
    return this.dataPipelineService.startAggregationJob(
      dto.metricTypes,
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }

  @Post('pipeline/cleanup')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Start cleanup job' })
  async startCleanupJob(@Body() dto: any) {
    return this.dataPipelineService.startCleanupJob(dto.retentionDays);
  }

  @Get('pipeline/jobs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all active pipeline jobs' })
  async getActiveJobs() {
    return this.dataPipelineService.getActiveJobs();
  }

  @Get('pipeline/jobs/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get pipeline job status' })
  async getJobStatus(@Param('id') id: string) {
    const job = this.dataPipelineService.getJobStatus(id);
    if (!job) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    return job;
  }

  @Post('pipeline/jobs/:id/pause')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Pause pipeline job' })
  async pauseJob(@Param('id') id: string) {
    const success = this.dataPipelineService.pauseJob(id);
    if (!success) {
      throw new HttpException('Unable to pause job', HttpStatus.BAD_REQUEST);
    }
    return { success: true };
  }

  @Post('pipeline/jobs/:id/resume')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Resume pipeline job' })
  async resumeJob(@Param('id') id: string) {
    const success = this.dataPipelineService.resumeJob(id);
    if (!success) {
      throw new HttpException('Unable to resume job', HttpStatus.BAD_REQUEST);
    }
    return { success: true };
  }

  @Post('pipeline/quality-check')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Run data quality checks' })
  async runDataQualityCheck(@Body() dto: RunDataQualityCheckDto) {
    return this.dataPipelineService.runDataQualityChecks(
      new Date(dto.dateFrom),
      new Date(dto.dateTo),
    );
  }
}
