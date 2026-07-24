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
import { GenerateReportDto } from './dto/generate-report.dto';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { QueryMetricsDto } from './dto/query-metrics.dto';
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
  ) {}

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
}