import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual, In } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SavedReport, ReportStatus, ReportFormat, ReportType } from '../entities/saved-report.entity';
import { AnalyticsMetric, MetricType } from '../entities/analytics-metric.entity';
import { GenerateReportDto } from '../dto/generate-report.dto';
import { Trade } from '../../trading-engine/entities/trade.entity';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);
  private readonly reportsDir = path.join(process.cwd(), 'reports');

  constructor(
    @InjectRepository(SavedReport)
    private readonly savedReportRepository: Repository<SavedReport>,
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  async createReport(userId: string, dto: GenerateReportDto): Promise<SavedReport> {
    const report = this.savedReportRepository.create({
      ...dto,
      userId,
      status: ReportStatus.PENDING,
      dateFrom: new Date(dto.dateFrom),
      dateTo: new Date(dto.dateTo),
    });

    const savedReport = await this.savedReportRepository.save(report);
    
    this.processReport(savedReport.id).catch(err => {
      this.logger.error(`Failed to process report ${savedReport.id}`, err);
    });

    return savedReport;
  }

  async processReport(reportId: string): Promise<void> {
    const report = await this.savedReportRepository.findOneBy({ id: reportId });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    try {
      report.status = ReportStatus.PROCESSING;
      await this.savedReportRepository.save(report);

      const reportData = await this.generateReportData(report);
      const fileResult = await this.exportReport(report, reportData);

      report.status = ReportStatus.COMPLETED;
      report.completedAt = new Date();
      report.fileUrl = fileResult.filePath;
      report.fileSize = fileResult.fileSize;
      
      await this.savedReportRepository.save(report);
      
      this.logger.log(`Report ${reportId} completed successfully`);
    } catch (error) {
      report.status = ReportStatus.FAILED;
      report.errorMessage = error.message;
      await this.savedReportRepository.save(report);
      this.logger.error(`Report ${reportId} failed`, error);
      throw error;
    }
  }

  private async generateReportData(report: SavedReport): Promise<any[]> {
    const { reportType, dateFrom, dateTo, filters } = report;

    switch (reportType) {
      case ReportType.TRADE_SUMMARY:
        return this.generateTradeSummaryReport(dateFrom, dateTo, filters);
      case ReportType.USER_ANALYTICS:
        return this.generateUserAnalyticsReport(dateFrom, dateTo, filters);
      case ReportType.REVENUE_REPORT:
        return this.generateRevenueReport(dateFrom, dateTo, filters);
      case ReportType.SYSTEM_HEALTH:
        return this.generateSystemHealthReport(dateFrom, dateTo, filters);
      case ReportType.BLOCKCHAIN_METRICS:
        return this.generateBlockchainMetricsReport(dateFrom, dateTo, filters);
      case ReportType.CUSTOM:
        return this.generateCustomReport(report, dateFrom, dateTo);
      default:
        throw new Error(`Unsupported report type: ${reportType}`);
    }
  }

  private async generateTradeSummaryReport(dateFrom: Date, dateTo: Date, filters?: Record<string, any>): Promise<any[]> {
    const query = this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.createdAt >= :dateFrom', { dateFrom })
      .andWhere('trade.createdAt <= :dateTo', { dateTo });

    if (filters?.assetCode) {
      query.andWhere('trade.assetCode = :assetCode', { assetCode: filters.assetCode });
    }
    if (filters?.settled !== undefined) {
      query.andWhere('trade.settled = :settled', { settled: filters.settled });
    }

    const trades = await query.getMany();

    return trades.map(trade => ({
      id: trade.id,
      createdAt: trade.createdAt,
      assetCode: trade.assetCode,
      quantity: trade.quantity,
      price: trade.price,
      totalValue: (parseFloat(trade.quantity) * parseFloat(trade.price)).toString(),
      settled: trade.settled,
      settledAt: trade.settledAt,
      makerUserId: trade.makerUserId,
      takerUserId: trade.takerUserId,
    }));
  }

  private async generateUserAnalyticsReport(dateFrom: Date, dateTo: Date, filters?: Record<string, any>): Promise<any[]> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.createdAt >= :dateFrom', { dateFrom })
      .andWhere('user.createdAt <= :dateTo', { dateTo });

    if (filters?.isActive !== undefined) {
      query.andWhere('user.isActive = :isActive', { isActive: filters.isActive });
    }

    const users = await query.getMany();

    return users.map(user => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      isActive: user.isActive,
      role: user.role,
    }));
  }

  private async generateRevenueReport(dateFrom: Date, dateTo: Date, filters?: Record<string, any>): Promise<any[]> {
    const metrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.TRANSACTION_FEE,
        timestamp: MoreThanOrEqual(dateFrom),
      },
      order: { timestamp: 'ASC' },
    });

    return metrics.map(metric => ({
      timestamp: metric.timestamp,
      aggregation: metric.aggregation,
      amount: metric.value,
      assetCode: metric.assetCode,
    }));
  }

  private async generateSystemHealthReport(dateFrom: Date, dateTo: Date, filters?: Record<string, any>): Promise<any[]> {
    const latencyMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.SYSTEM_LATENCY,
        timestamp: MoreThanOrEqual(dateFrom),
      },
      order: { timestamp: 'ASC' },
    });

    const errorMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.ERROR_RATE,
        timestamp: MoreThanOrEqual(dateFrom),
      },
      order: { timestamp: 'ASC' },
    });

    return [...latencyMetrics, ...errorMetrics].map(metric => ({
      timestamp: metric.timestamp,
      metricType: metric.metricType,
      value: metric.value,
      source: metric.source,
    }));
  }

  private async generateBlockchainMetricsReport(dateFrom: Date, dateTo: Date, filters?: Record<string, any>): Promise<any[]> {
    const gasMetrics = await this.analyticsMetricRepository.find({
      where: {
        metricType: MetricType.BLOCKCHAIN_GAS,
        timestamp: MoreThanOrEqual(dateFrom),
      },
      order: { timestamp: 'ASC' },
    });

    return gasMetrics.map(metric => ({
      timestamp: metric.timestamp,
      gasUsed: metric.value,
      aggregation: metric.aggregation,
    }));
  }

  private async generateCustomReport(report: SavedReport, dateFrom: Date, dateTo: Date): Promise<any[]> {
    const whereClause: any = {
      timestamp: MoreThanOrEqual(dateFrom),
    };
    
    if (report.metrics && Array.isArray(report.metrics)) {
      whereClause.metricType = In(report.metrics);
    }
    
    const metrics = await this.analyticsMetricRepository.find({
      where: whereClause,
      order: { timestamp: 'ASC' },
    });

    return metrics.map(metric => ({
      timestamp: metric.timestamp,
      metricType: metric.metricType,
      value: metric.value,
      aggregation: metric.aggregation,
      assetCode: metric.assetCode,
      userId: metric.userId,
      dimensions: metric.dimensions,
    }));
  }

  private async exportReport(report: SavedReport, data: any[]): Promise<{ filePath: string; fileSize: number }> {
    const fileName = `${report.id}_${report.name.replace(/\s+/g, '_')}.${report.format}`;
    const filePath = path.join(this.reportsDir, fileName);

    switch (report.format) {
      case ReportFormat.CSV:
        await this.exportToCSV(data, filePath);
        break;
      case ReportFormat.JSON:
        await this.exportToJSON(data, filePath);
        break;
      default:
        await this.exportToJSON(data, filePath);
    }

    const stats = fs.statSync(filePath);
    return { filePath, fileSize: stats.size };
  }

  // CSV export temporarily disabled until csv-writer is installed
  private async exportToCSV(data: any[], filePath: string): Promise<void> {
    if (data.length === 0) {
      fs.writeFileSync(filePath, '');
      return;
    }

    // CSV functionality requires csv-writer package - using JSON export instead
    await this.exportToJSON(data, filePath);
  }

  private async exportToJSON(data: any[], filePath: string): Promise<void> {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  async getReport(reportId: string): Promise<SavedReport> {
    const report = await this.savedReportRepository.findOneBy({ id: reportId });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }
    return report;
  }

  async getUserReports(userId: string): Promise<SavedReport[]> {
    return this.savedReportRepository.find({
      where: { userId, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteReport(reportId: string): Promise<void> {
    const report = await this.savedReportRepository.findOneBy({ id: reportId });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    report.isDeleted = true;
    await this.savedReportRepository.save(report);

    if (report.fileUrl && fs.existsSync(report.fileUrl)) {
      fs.unlinkSync(report.fileUrl);
    }
  }
}