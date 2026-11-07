import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull } from 'typeorm';
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

/** Parsed 5-field cron expression (minute, hour, day-of-month, month, weekday). */
export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when the raw day-of-month field was '*' (unrestricted). */
  dayOfMonthRestricted: boolean;
  /** True when the raw day-of-week field was '*' (unrestricted). */
  dayOfWeekRestricted: boolean;
  readonly expression: string;
}

function parseCronField(field: string, min: number, max: number, label: string): { values: Set<number>; restricted: boolean } {
  const trimmed = field.trim();
  if (trimmed.length === 0) {
    throw new Error(`Invalid cron expression: empty ${label} field`);
  }
  const values = new Set<number>();
  for (const part of trimmed.split(',')) {
    const token = part.trim();
    if (token.length === 0) {
      throw new Error(`Invalid cron expression: empty ${label} entry`);
    }
    let range = token;
    let step = 1;
    if (token.includes('/')) {
      const [rangePart, stepPart] = token.split('/');
      if (!rangePart || !stepPart || !/^\d+$/.test(stepPart)) {
        throw new Error(`Invalid cron step for ${label}: "${token}"`);
      }
      step = Number.parseInt(stepPart, 10);
      if (step <= 0) {
        throw new Error(`Invalid cron step for ${label}: "${token}"`);
      }
      range = rangePart;
    }
    let start = min;
    let end = max;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [startPart, endPart] = range.split('-');
      if (!/^\d+$/.test(startPart ?? '') || !/^\d+$/.test(endPart ?? '')) {
        throw new Error(`Invalid cron range for ${label}: "${token}"`);
      }
      start = Number.parseInt(startPart, 10);
      end = Number.parseInt(endPart, 10);
      if (start > end) {
        throw new Error(`Invalid cron range for ${label}: "${token}" (start after end)`);
      }
    } else {
      if (!/^\d+$/.test(range)) {
        throw new Error(`Invalid cron value for ${label}: "${token}"`);
      }
      start = end = Number.parseInt(range, 10);
    }
    if (start < min || end > max) {
      throw new Error(`Cron ${label} out of range [${min}, ${max}]: "${token}"`);
    }
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  if (values.size === 0) {
    throw new Error(`Invalid cron expression: ${label} selects no values`);
  }
  return { values, restricted: trimmed !== '*' };
}

/** Parses a standard 5-field cron expression (numeric fields only). */
export function parseCronExpression(expression: string): CronSchedule {
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    throw new Error('CUSTOM frequency requires a valid cronExpression');
  }
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}": expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  const minuteParsed = parseCronField(minute, 0, 59, 'minute');
  const hourParsed = parseCronField(hour, 0, 23, 'hour');
  const domParsed = parseCronField(dayOfMonth, 1, 31, 'day-of-month');
  const monthParsed = parseCronField(month, 1, 12, 'month');
  const dowParsed = parseCronField(dayOfWeek, 0, 7, 'day-of-week');
  // Day-of-week 7 is an alias for Sunday (0).
  if (dowParsed.values.has(7)) {
    dowParsed.values.delete(7);
    dowParsed.values.add(0);
  }
  return {
    minute: minuteParsed.values,
    hour: hourParsed.values,
    dayOfMonth: domParsed.values,
    month: monthParsed.values,
    dayOfWeek: dowParsed.values,
    dayOfMonthRestricted: domParsed.restricted,
    dayOfWeekRestricted: dowParsed.restricted,
    expression: expression.trim(),
  };
}

function cronMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minute.has(date.getMinutes())) {
    return false;
  }
  if (!schedule.hour.has(date.getHours())) {
    return false;
  }
  if (!schedule.month.has(date.getMonth() + 1)) {
    return false;
  }
  const domMatches = schedule.dayOfMonth.has(date.getDate());
  const dowMatches = schedule.dayOfWeek.has(date.getDay());
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return domMatches || dowMatches;
  }
  if (schedule.dayOfMonthRestricted) {
    return domMatches;
  }
  if (schedule.dayOfWeekRestricted) {
    return dowMatches;
  }
  return true;
}

/**
 * Computes the first date strictly after `from` that matches `expression`.
 * Iteration is minute-by-minute (at most ~366 days), which is cheap enough
 * for schedule-time computation and fully deterministic for tests.
 */
export function calculateNextRunFromCron(expression: string, from: Date = new Date()): Date {
  const schedule = parseCronExpression(expression);
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    if (cronMatches(schedule, candidate)) {
      return new Date(candidate.getTime());
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error(`No next run found for cron "${expression}" within 366 days`);
}

function setsEqual(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
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

    const scheduleCron = this.getCronForFrequency(
      config.frequency,
      config.cronExpression,
    );
    const nextRunAt = this.calculateNextRun(
      config.frequency,
      scheduleCron,
      new Date(),
    );

    // Persist the computed schedule on the row so processScheduledReports()
    // can match it with nextRunAt <= now (previously never saved).
    report.isScheduled = true;
    report.scheduleCron = scheduleCron;
    report.scheduleFrequency = config.frequency;
    report.recipients = [...(config.recipients ?? [])];
    report.nextRunAt = nextRunAt;
    await this.savedReportRepository.save(report);

    if (!config.recipients || config.recipients.length === 0) {
      this.logger.warn(
        `Report ${reportId} scheduled with no recipients; delivery will not be marked sent`,
      );
    }

    const scheduledConfig: ScheduledReportConfig = {
      id: `sched_${reportId}_${Date.now()}`,
      reportId,
      frequency: config.frequency,
      cronExpression: scheduleCron,
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

    // Skip-and-log rows from a partially-migrated dataset whose nextRunAt
    // was never persisted; they can never match the due query below.
    const missingNextRunAt = await this.savedReportRepository.find({
      where: {
        isScheduled: true,
        status: ReportStatus.COMPLETED,
        nextRunAt: IsNull(),
      },
    });
    for (const skipped of missingNextRunAt) {
      this.logger.warn(
        `Skipping scheduled report ${skipped.id}: nextRunAt is null (schedule was never persisted)`,
      );
    }

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

    const frequency = this.resolveReportFrequency(report);
    const cron = report.scheduleCron ?? this.getCronForFrequency(frequency);

    // Create a new report instance based on the template
    const newReport = await this.reportGeneratorService.createReport(
      report.userId,
      {
        name: `${report.name} - ${new Date().toISOString().split('T')[0]}`,
        reportType: report.reportType as ReportType,
        format: report.format as ReportFormat,
        dateFrom: this.getStartDateForFrequency(frequency, new Date()),
        dateTo: new Date().toISOString(),
        filters: report.filters,
        metrics: report.metrics,
        dimensions: report.dimensions,
      },
    );

    // Update next run time from the stored frequency/cron.
    const now = new Date();
    report.nextRunAt = this.calculateNextRun(frequency, cron, now);
    report.lastRunAt = now;
    await this.savedReportRepository.save(report);

    // Deliver to the recipients persisted at schedule time. An empty list
    // must not be reported as sent (see sendReportToRecipients).
    const recipients = report.recipients ?? [];
    const delivery = await this.sendReportToRecipients(newReport, recipients);
    if (delivery.status !== 'sent') {
      this.logger.warn(
        `Scheduled report ${report.id} was not delivered (status=${delivery.status}): ${delivery.errorMessage ?? 'no recipients'}`,
      );
      return;
    }

    this.logger.log(`Scheduled report ${report.id} processed successfully`);
  }

  /** Prefers the stored frequency; falls back to parsing the cron for legacy rows. */
  private resolveReportFrequency(report: SavedReport): ScheduleFrequency {
    if (
      report.scheduleFrequency &&
      Object.values(ScheduleFrequency).includes(
        report.scheduleFrequency as ScheduleFrequency,
      )
    ) {
      return report.scheduleFrequency as ScheduleFrequency;
    }
    return this.getFrequencyFromCron(report.scheduleCron ?? '');
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

    // A report with no recipients was not delivered; never mark it sent.
    if (!recipients || recipients.length === 0) {
      delivery.status = 'failed';
      delivery.errorMessage = 'No recipients configured for scheduled report';
      this.logger.warn(
        `Skipping delivery for report ${report.id}: no recipients configured`,
      );
      return delivery;
    }

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
      const scheduleCron = this.getCronForFrequency(
        config.frequency,
        config.cronExpression,
      );
      report.scheduleCron = scheduleCron;
      report.scheduleFrequency = config.frequency;
      report.nextRunAt = this.calculateNextRun(
        config.frequency,
        scheduleCron,
        new Date(),
      );
    } else if (config.cronExpression) {
      report.scheduleCron = config.cronExpression;
      report.scheduleFrequency = ScheduleFrequency.CUSTOM;
      report.nextRunAt = this.calculateNextRun(
        ScheduleFrequency.CUSTOM,
        config.cronExpression,
        new Date(),
      );
    }

    if (config.recipients !== undefined) {
      report.recipients = [...config.recipients];
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
    report.scheduleFrequency = undefined;
    report.recipients = undefined;
    report.nextRunAt = undefined;
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

  private getCronForFrequency(
    frequency: ScheduleFrequency,
    cronExpression?: string,
  ): string {
    switch (frequency) {
      case ScheduleFrequency.DAILY:
        return '0 0 * * *'; // Every day at midnight
      case ScheduleFrequency.WEEKLY:
        return '0 0 * * 0'; // Every Sunday at midnight
      case ScheduleFrequency.MONTHLY:
        return '0 0 1 * *'; // First day of month at midnight
      case ScheduleFrequency.QUARTERLY:
        return '0 0 1 1,4,7,10 *'; // First day of quarter
      case ScheduleFrequency.CUSTOM:
        if (!cronExpression || cronExpression.trim().length === 0) {
          throw new Error(
            'CUSTOM frequency requires a cronExpression (e.g. "30 2 * * *")',
          );
        }
        // Validate (and normalize whitespace) but never discard the expression.
        parseCronExpression(cronExpression);
        return cronExpression.trim();
      default:
        throw new Error(`Unknown schedule frequency: ${String(frequency)}`);
    }
  }

  private calculateNextRun(
    frequency: ScheduleFrequency,
    cronExpression?: string,
    from: Date = new Date(),
  ): Date {
    if (frequency === ScheduleFrequency.CUSTOM) {
      return calculateNextRunFromCron(cronExpression ?? '', from);
    }
    const next = new Date(from.getTime());

    switch (frequency) {
      case ScheduleFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
        break;
      case ScheduleFrequency.WEEKLY: {
        const advance = 7 - next.getDay();
        // When today is Sunday, the next Sunday is 7 days away, not "today".
        next.setDate(next.getDate() + (advance === 7 ? 7 : advance === 0 ? 7 : advance));
        next.setHours(0, 0, 0, 0);
        break;
      }
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
        throw new Error(`Unknown schedule frequency: ${String(frequency)}`);
    }

    return next;
  }

  private getStartDateForFrequency(
    frequency: ScheduleFrequency | string,
    from: Date = new Date(),
  ): string {
    const resolved = Object.values(ScheduleFrequency).includes(
      frequency as ScheduleFrequency,
    )
      ? (frequency as ScheduleFrequency)
      : this.getFrequencyFromCron(frequency as string);
    const start = new Date(from.getTime());
    switch (resolved) {
      case ScheduleFrequency.QUARTERLY:
        start.setMonth(start.getMonth() - 3);
        break;
      case ScheduleFrequency.MONTHLY:
        start.setMonth(start.getMonth() - 1);
        break;
      case ScheduleFrequency.WEEKLY:
        start.setDate(start.getDate() - 7);
        break;
      case ScheduleFrequency.DAILY:
      case ScheduleFrequency.CUSTOM:
      default:
        start.setDate(start.getDate() - 1);
        break;
    }
    return start.toISOString();
  }

  private getFrequencyFromCron(cronExpression: string): ScheduleFrequency {
    if (!cronExpression || cronExpression.trim().length === 0) {
      return ScheduleFrequency.CUSTOM;
    }
    let schedule: CronSchedule;
    try {
      schedule = parseCronExpression(cronExpression);
    } catch {
      return ScheduleFrequency.CUSTOM;
    }
    const set = (values: number[]) => new Set(values);
    const full = (min: number, max: number) => new Set(Array.from({ length: max - min + 1 }, (_, index) => min + index));
    if (
      setsEqual(schedule.minute, set([0])) &&
      setsEqual(schedule.hour, set([0])) &&
      setsEqual(schedule.dayOfMonth, full(1, 31)) &&
      setsEqual(schedule.month, full(1, 12)) &&
      setsEqual(schedule.dayOfWeek, set([0, 1, 2, 3, 4, 5, 6]))
    ) {
      return ScheduleFrequency.DAILY;
    }
    if (
      setsEqual(schedule.minute, set([0])) &&
      setsEqual(schedule.hour, set([0])) &&
      setsEqual(schedule.dayOfMonth, full(1, 31)) &&
      setsEqual(schedule.month, full(1, 12)) &&
      setsEqual(schedule.dayOfWeek, set([0]))
    ) {
      return ScheduleFrequency.WEEKLY;
    }
    if (
      setsEqual(schedule.minute, set([0])) &&
      setsEqual(schedule.hour, set([0])) &&
      setsEqual(schedule.dayOfMonth, set([1])) &&
      setsEqual(schedule.month, full(1, 12)) &&
      setsEqual(schedule.dayOfWeek, set([0, 1, 2, 3, 4, 5, 6]))
    ) {
      return ScheduleFrequency.MONTHLY;
    }
    if (
      setsEqual(schedule.minute, set([0])) &&
      setsEqual(schedule.hour, set([0])) &&
      setsEqual(schedule.dayOfMonth, set([1])) &&
      setsEqual(schedule.month, set([1, 4, 7, 10])) &&
      setsEqual(schedule.dayOfWeek, set([0, 1, 2, 3, 4, 5, 6]))
    ) {
      return ScheduleFrequency.QUARTERLY;
    }
    return ScheduleFrequency.CUSTOM;
  }
}
