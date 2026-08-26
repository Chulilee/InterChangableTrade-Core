import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import {
  SavedReport,
  ReportStatus,
  ReportType,
  ReportFormat,
} from '../entities/saved-report.entity';
import { ReportGeneratorService } from './report-generator.service';

export enum ScheduleFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  CUSTOM = 'custom',
}

export interface ScheduledReportConfig {
  id: string;
  reportId: string;
  frequency: ScheduleFrequency;
  cronExpression?: string;
  recipients: string[];
  includeCharts: boolean;
  includeSummary: boolean;
  customParameters?: Record<string, any>;
  nextRunAt: Date;
  lastRunAt?: Date;
  isActive: boolean;
}

export interface ReportDelivery {
  id: string;
  reportId: string;
  scheduledConfigId: string;
  sentAt: Date;
  recipients: string[];
  status: 'sent' | 'failed' | 'pending';
  errorMessage?: string;
  fileUrl?: string;
}

@Injectable()
export class ScheduledReportService {
  private readonly logger = new Logger(ScheduledReportService.name);

  constructor(
    @InjectRepository(SavedReport)
    private readonly savedReportRepository: Repository<SavedReport>,
    private readonly reportGeneratorService: ReportGeneratorService,
  ) {}

  /**
   * Schedule a report for automatic generation
   */
  async scheduleReport(
    reportId: string,
    config: {
      frequency: ScheduleFrequency;
      cronExpression?: string;
      recipients: string[];
      includeCharts?: boolean;
      includeSummary?: boolean;
      customParameters?: Record<string, any>;
    },
  ): Promise<ScheduledReportConfig> {
    const report = await this.savedReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    // Update report with scheduling info
    report.isScheduled = true;
    report.scheduleCron =
      config.cronExpression ?? this.getCronForFrequency(config.frequency);
    await this.savedReportRepository.save(report);

    const nextRunAt = this.calculateNextRun(
      config.frequency,
      config.cronExpression,
    );

    const scheduledConfig: ScheduledReportConfig = {
      id: `sched_${reportId}_${Date.now()}`,
      reportId,
      frequency: config.frequency,
      cronExpression: config.cronExpression,
      recipients: config.recipients,
      includeCharts: config.includeCharts ?? true,
      includeSummary: config.includeSummary ?? true,
      customParameters: config.customParameters,
      nextRunAt,
      isActive: true,
    };

    this.logger.log(
      `Report ${reportId} scheduled for ${config.frequency} execution`,
    );

    return scheduledConfig;
  }

  /**
   * Process scheduled reports that are due
   */
  async processScheduledReports(): Promise<void> {
    const now = new Date();

    // Find reports that are scheduled and due
    const dueReports = await this.savedReportRepository.find({
      where: {
        isScheduled: true,
        status: ReportStatus.COMPLETED,
        nextRunAt: LessThanOrEqual(now),
      },
    });

    this.logger.log(`Processing ${dueReports.length} scheduled reports`);

    for (const report of dueReports) {
      try {
        await this.processScheduledReport(report);
      } catch (error) {
        this.logger.error(
          `Failed to process scheduled report ${report.id}`,
          error,
        );
      }
    }
  }

  /**
   * Process a single scheduled report
   */
  private async processScheduledReport(report: SavedReport): Promise<void> {
    this.logger.log(`Processing scheduled report ${report.id}`);

    // Create a new report instance based on the template
    const newReport = await this.reportGeneratorService.createReport(
      report.userId,
      {
        name: `${report.name} - ${new Date().toISOString().split('T')[0]}`,
        reportType: report.reportType as ReportType,
        format: report.format as ReportFormat,
        dateFrom: this.getStartDateForFrequency(report.scheduleCron ?? ''),
        dateTo: new Date().toISOString(),
        filters: report.filters,
        metrics: report.metrics,
        dimensions: report.dimensions,
      },
    );

    // Update next run time
    report.nextRunAt = this.calculateNextRun(
      this.getFrequencyFromCron(report.scheduleCron ?? ''),
      report.scheduleCron,
    );
    report.lastRunAt = new Date();
    await this.savedReportRepository.save(report);

    // Send to recipients (placeholder - would integrate with email service)
    await this.sendReportToRecipients(newReport, []);

    this.logger.log(`Scheduled report ${report.id} processed successfully`);
  }

  /**
   * Send report to recipients via email
   */
  async sendReportToRecipients(
    report: SavedReport,
    recipients: string[],
  ): Promise<ReportDelivery> {
    const delivery: ReportDelivery = {
      id: `delivery_${report.id}_${Date.now()}`,
      reportId: report.id,
      scheduledConfigId: '',
      sentAt: new Date(),
      recipients,
      status: 'pending',
    };

    try {
      // In production, this would integrate with an email service
      // For now, log the delivery
      this.logger.log(
        `Sending report ${report.id} to ${recipients.length} recipients`,
      );

      // Simulate email sending
      await new Promise((resolve) => setTimeout(resolve, 100));

      delivery.status = 'sent';
      delivery.fileUrl = report.fileUrl;

      this.logger.log(`Report ${report.id} sent successfully`);
    } catch (error) {
      delivery.status = 'failed';
      delivery.errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send report ${report.id}`, error);
    }

    return delivery;
  }

  /**
   * Get all scheduled reports
   */
  async getScheduledReports(): Promise<SavedReport[]> {
    return this.savedReportRepository.find({
      where: { isScheduled: true },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update schedule for a report
   */
  async updateSchedule(
    reportId: string,
    config: {
      frequency?: ScheduleFrequency;
      cronExpression?: string;
      recipients?: string[];
      isActive?: boolean;
    },
  ): Promise<SavedReport> {
    const report = await this.savedReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    if (config.frequency) {
      report.scheduleCron =
        config.cronExpression ?? this.getCronForFrequency(config.frequency);
      report.nextRunAt = this.calculateNextRun(
        config.frequency,
        config.cronExpression,
      );
    }

    if (config.isActive !== undefined) {
      report.isScheduled = config.isActive;
    }

    await this.savedReportRepository.save(report);

    this.logger.log(`Schedule updated for report ${reportId}`);
    return report;
  }

  /**
   * Remove schedule for a report
   */
  async removeSchedule(reportId: string): Promise<void> {
    const report = await this.savedReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    report.isScheduled = false;
    report.scheduleCron = undefined;
    await this.savedReportRepository.save(report);

    this.logger.log(`Schedule removed for report ${reportId}`);
  }

  /**
   * Get report delivery history
   */
  async getDeliveryHistory(
    reportId: string,
    limit: number = 50,
  ): Promise<ReportDelivery[]> {
    // In production, this would query from a delivery history table
    // For now, return placeholder data
    return [];
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  private getCronForFrequency(frequency: ScheduleFrequency): string {
    switch (frequency) {
      case ScheduleFrequency.DAILY:
        return '0 0 * * *'; // Every day at midnight
      case ScheduleFrequency.WEEKLY:
        return '0 0 * * 0'; // Every Sunday at midnight
      case ScheduleFrequency.MONTHLY:
        return '0 0 1 * *'; // First day of month at midnight
      case ScheduleFrequency.QUARTERLY:
        return '0 0 1 1,4,7,10 *'; // First day of quarter
      default:
        return '0 0 * * *';
    }
  }

  private calculateNextRun(
    frequency: ScheduleFrequency,
    cronExpression?: string,
  ): Date {
    const now = new Date();
    const next = new Date(now);

    switch (frequency) {
      case ScheduleFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
        break;
      case ScheduleFrequency.WEEKLY:
        next.setDate(next.getDate() + (7 - next.getDay()));
        next.setHours(0, 0, 0, 0);
        break;
      case ScheduleFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
        next.setHours(0, 0, 0, 0);
        break;
      case ScheduleFrequency.QUARTERLY: {
        const currentQuarter = Math.floor(next.getMonth() / 3);
        const nextQuarterMonth = (currentQuarter + 1) * 3;
        next.setMonth(nextQuarterMonth);
        next.setDate(1);
        next.setHours(0, 0, 0, 0);
        break;
      }
      default:
        next.setDate(next.getDate() + 1);
    }

    return next;
  }

  private getStartDateForFrequency(cronExpression: string): string {
    const now = new Date();

    // Simple heuristic based on cron expression
    if (cronExpression.includes('0 0 1 1,4,7,10')) {
      // Quarterly
      now.setMonth(now.getMonth() - 3);
    } else if (cronExpression.includes('0 0 1 *')) {
      // Monthly
      now.setMonth(now.getMonth() - 1);
    } else if (cronExpression.includes('0 0 * * 0')) {
      // Weekly
      now.setDate(now.getDate() - 7);
    } else {
      // Daily or default
      now.setDate(now.getDate() - 1);
    }

    return now.toISOString();
  }

  private getFrequencyFromCron(cronExpression: string): ScheduleFrequency {
    if (cronExpression.includes('0 0 1 1,4,7,10')) {
      return ScheduleFrequency.QUARTERLY;
    } else if (cronExpression.includes('0 0 1 *')) {
      return ScheduleFrequency.MONTHLY;
    } else if (cronExpression.includes('0 0 * * 0')) {
      return ScheduleFrequency.WEEKLY;
    } else {
      return ScheduleFrequency.DAILY;
    }
  }
}
