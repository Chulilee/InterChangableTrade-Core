import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { AnalyticsMetric, MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { MetricsCollectorService } from './metrics-collector.service';

export enum PipelineStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
}

export interface PipelineJob {
  id: string;
  name: string;
  status: PipelineStatus;
  type: 'etl' | 'backfill' | 'aggregation' | 'cleanup';
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface EtlConfig {
  sourceType: 'blockchain' | 'database' | 'api';
  sourceConnection?: string;
  targetType: 'analytics_metrics';
  batchSize: number;
  parallelWorkers: number;
  filters?: Record<string, any>;
}

export interface BackfillConfig {
  metricTypes: MetricType[];
  dateFrom: Date;
  dateTo: Date;
  aggregation: MetricAggregation;
  overwrite: boolean;
}

export interface DataQualityReport {
  timestamp: Date;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  completeness: number;
  accuracy: number;
  consistency: number;
  issues: DataQualityIssue[];
}

export interface DataQualityIssue {
  type: 'missing' | 'duplicate' | 'invalid' | 'inconsistent';
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedRecords: number;
  sampleIds?: string[];
}

@Injectable()
export class DataPipelineService {
  private readonly logger = new Logger(DataPipelineService.name);
  private readonly activeJobs = new Map<string, PipelineJob>();

  constructor(
    @InjectRepository(AnalyticsMetric)
    private readonly analyticsMetricRepository: Repository<AnalyticsMetric>,
    private readonly metricsCollectorService: MetricsCollectorService,
  ) {}

  /**
   * Start an ETL pipeline job
   */
  async startEtlJob(config: EtlConfig): Promise<PipelineJob> {
    const job: PipelineJob = {
      id: `etl_${Date.now()}`,
      name: `ETL Job - ${config.sourceType}`,
      status: PipelineStatus.RUNNING,
      type: 'etl',
      startedAt: new Date(),
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      metadata: config,
    };

    this.activeJobs.set(job.id, job);

    // Process asynchronously
    this.processEtlJob(job, config).catch(error => {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error.message;
      this.logger.error(`ETL job ${job.id} failed`, error);
    });

    return job;
  }

  /**
   * Start a backfill job
   */
  async startBackfillJob(config: BackfillConfig): Promise<PipelineJob> {
    const job: PipelineJob = {
      id: `backfill_${Date.now()}`,
      name: `Backfill Job - ${config.metricTypes.join(', ')}`,
      status: PipelineStatus.RUNNING,
      type: 'backfill',
      startedAt: new Date(),
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      metadata: config,
    };

    this.activeJobs.set(job.id, job);

    // Process asynchronously
    this.processBackfillJob(job, config).catch(error => {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error.message;
      this.logger.error(`Backfill job ${job.id} failed`, error);
    });

    return job;
  }

  /**
   * Start an aggregation job
   */
  async startAggregationJob(
    metricTypes: MetricType[],
    dateFrom: Date,
    dateTo: Date,
  ): Promise<PipelineJob> {
    const job: PipelineJob = {
      id: `agg_${Date.now()}`,
      name: `Aggregation Job - ${metricTypes.join(', ')}`,
      status: PipelineStatus.RUNNING,
      type: 'aggregation',
      startedAt: new Date(),
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      metadata: { metricTypes, dateFrom, dateTo },
    };

    this.activeJobs.set(job.id, job);

    // Process asynchronously
    this.processAggregationJob(job, metricTypes, dateFrom, dateTo).catch(error => {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error.message;
      this.logger.error(`Aggregation job ${job.id} failed`, error);
    });

    return job;
  }

  /**
   * Start a cleanup job
   */
  async startCleanupJob(retentionDays: number = 730): Promise<PipelineJob> {
    const job: PipelineJob = {
      id: `cleanup_${Date.now()}`,
      name: `Cleanup Job - Retention ${retentionDays} days`,
      status: PipelineStatus.RUNNING,
      type: 'cleanup',
      startedAt: new Date(),
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      metadata: { retentionDays },
    };

    this.activeJobs.set(job.id, job);

    // Process asynchronously
    this.processCleanupJob(job, retentionDays).catch(error => {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error.message;
      this.logger.error(`Cleanup job ${job.id} failed`, error);
    });

    return job;
  }

  /**
   * Get status of a pipeline job
   */
  getJobStatus(jobId: string): PipelineJob | undefined {
    return this.activeJobs.get(jobId);
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): PipelineJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Pause a running job
   */
  pauseJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === PipelineStatus.RUNNING) {
      job.status = PipelineStatus.PAUSED;
      return true;
    }
    return false;
  }

  /**
   * Resume a paused job
   */
  resumeJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === PipelineStatus.PAUSED) {
      job.status = PipelineStatus.RUNNING;
      return true;
    }
    return false;
  }

  /**
   * Run data quality checks
   */
  async runDataQualityChecks(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<DataQualityReport> {
    const issues: DataQualityIssue[] = [];

    // Check for missing data
    const missingCheck = await this.checkMissingData(dateFrom, dateTo);
    if (missingCheck.affectedRecords > 0) {
      issues.push(missingCheck);
    }

    // Check for duplicates
    const duplicateCheck = await this.checkDuplicates(dateFrom, dateTo);
    if (duplicateCheck.affectedRecords > 0) {
      issues.push(duplicateCheck);
    }

    // Check for invalid values
    const invalidCheck = await this.checkInvalidValues(dateFrom, dateTo);
    if (invalidCheck.affectedRecords > 0) {
      issues.push(invalidCheck);
    }

    // Calculate metrics
    const totalRecords = await this.analyticsMetricRepository.count({
      where: { timestamp: Between(dateFrom, dateTo) },
    });

    const invalidRecords = issues.reduce((sum, issue) => sum + issue.affectedRecords, 0);
    const validRecords = totalRecords - invalidRecords;

    return {
      timestamp: new Date(),
      totalRecords,
      validRecords,
      invalidRecords,
      completeness: totalRecords > 0 ? (validRecords / totalRecords) * 100 : 100,
      accuracy: totalRecords > 0 ? (validRecords / totalRecords) * 100 : 100,
      consistency: 100, // Would need cross-table checks
      issues,
    };
  }

  // ─── Private helper methods ─────────────────────────────────────────────

  private async processEtlJob(job: PipelineJob, config: EtlConfig): Promise<void> {
    this.logger.log(`Processing ETL job ${job.id}`);

    try {
      // Simulate ETL processing
      const totalBatches = 10;
      
      for (let i = 0; i < totalBatches; i++) {
        if (job.status === PipelineStatus.PAUSED) {
          await this.waitForResume(job.id);
        }

        // Process batch
        await new Promise(resolve => setTimeout(resolve, 100));
        
        job.processedRecords += config.batchSize;
        job.progress = ((i + 1) / totalBatches) * 100;
        
        this.logger.debug(`ETL job ${job.id}: ${job.progress.toFixed(1)}% complete`);
      }

      job.status = PipelineStatus.COMPLETED;
      job.completedAt = new Date();
      job.progress = 100;
      
      this.logger.log(`ETL job ${job.id} completed`);
    } catch (error) {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  private async processBackfillJob(job: PipelineJob, config: BackfillConfig): Promise<void> {
    this.logger.log(`Processing backfill job ${job.id}`);

    try {
      const dateRange = config.dateTo.getTime() - config.dateFrom.getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      const totalDays = Math.ceil(dateRange / dayMs);
      
      job.totalRecords = totalDays * config.metricTypes.length;

      for (let i = 0; i < totalDays; i++) {
        if (job.status === PipelineStatus.PAUSED) {
          await this.waitForResume(job.id);
        }

        const currentDate = new Date(config.dateFrom.getTime() + i * dayMs);
        const nextDate = new Date(currentDate.getTime() + dayMs);

        // Collect metrics for each type
        for (const metricType of config.metricTypes) {
          try {
            await this.metricsCollectorService.recordMetric(
              metricType,
              '0', // Would calculate actual value
              currentDate,
              undefined,
              undefined,
              undefined,
              undefined,
              'backfill',
            );
            job.processedRecords++;
          } catch (error) {
            job.failedRecords++;
            this.logger.warn(`Failed to backfill ${metricType} for ${currentDate}`);
          }
        }

        job.progress = ((i + 1) / totalDays) * 100;
      }

      job.status = PipelineStatus.COMPLETED;
      job.completedAt = new Date();
      job.progress = 100;
      
      this.logger.log(`Backfill job ${job.id} completed`);
    } catch (error) {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  private async processAggregationJob(
    job: PipelineJob,
    metricTypes: MetricType[],
    dateFrom: Date,
    dateTo: Date,
  ): Promise<void> {
    this.logger.log(`Processing aggregation job ${job.id}`);

    try {
      // Get raw metrics
      const rawMetrics = await this.analyticsMetricRepository.find({
        where: {
          metricType: metricTypes.length === 1 ? metricTypes[0] : undefined,
          timestamp: Between(dateFrom, dateTo),
          aggregation: MetricAggregation.MINUTE,
        },
      });

      job.totalRecords = rawMetrics.length;

      // Aggregate by hour, day, week, month
      const aggregations = [
        MetricAggregation.HOUR,
        MetricAggregation.DAY,
        MetricAggregation.WEEK,
        MetricAggregation.MONTH,
      ];

      for (const aggregation of aggregations) {
        // Group and aggregate
        const grouped = this.groupMetricsForAggregation(rawMetrics, aggregation);
        
        for (const [key, metrics] of grouped) {
          const aggregatedValue = this.aggregateMetricValues(metrics);
          
          await this.analyticsMetricRepository.save({
            metricType: metrics[0].metricType,
            aggregation,
            timestamp: new Date(key),
            value: aggregatedValue.toString(),
            assetCode: metrics[0].assetCode,
          });
          
          job.processedRecords++;
        }
      }

      job.status = PipelineStatus.COMPLETED;
      job.completedAt = new Date();
      job.progress = 100;
      
      this.logger.log(`Aggregation job ${job.id} completed`);
    } catch (error) {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  private async processCleanupJob(job: PipelineJob, retentionDays: number): Promise<void> {
    this.logger.log(`Processing cleanup job ${job.id}`);

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await this.analyticsMetricRepository
        .createQueryBuilder()
        .delete()
        .where('timestamp < :cutoffDate', { cutoffDate })
        .execute();

      job.totalRecords = result.affected ?? 0;
      job.processedRecords = result.affected ?? 0;
      job.status = PipelineStatus.COMPLETED;
      job.completedAt = new Date();
      job.progress = 100;
      
      this.logger.log(`Cleanup job ${job.id} completed: ${result.affected} records removed`);
    } catch (error) {
      job.status = PipelineStatus.FAILED;
      job.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  private async waitForResume(jobId: string): Promise<void> {
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        const job = this.activeJobs.get(jobId);
        if (job && job.status !== PipelineStatus.PAUSED) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  private groupMetricsForAggregation(
    metrics: AnalyticsMetric[],
    aggregation: MetricAggregation,
  ): Map<string, AnalyticsMetric[]> {
    const grouped = new Map<string, AnalyticsMetric[]>();

    for (const metric of metrics) {
      const key = this.getAggregationKey(metric.timestamp, aggregation);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(metric);
    }

    return grouped;
  }

  private getAggregationKey(date: Date, aggregation: MetricAggregation): string {
    const d = new Date(date);
    
    switch (aggregation) {
      case MetricAggregation.HOUR:
        d.setMinutes(0, 0, 0);
        break;
      case MetricAggregation.DAY:
        d.setHours(0, 0, 0, 0);
        break;
      case MetricAggregation.WEEK: {
        const day = d.getDay();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - day);
        break;
      }
      case MetricAggregation.MONTH:
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        break;
    }
    
    return d.toISOString();
  }

  private aggregateMetricValues(metrics: AnalyticsMetric[]): number {
    // Simple sum aggregation - would use different methods based on metric type
    return metrics.reduce((sum, m) => sum + parseFloat(m.value), 0);
  }

  private async checkMissingData(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<DataQualityIssue> {
    // Check for gaps in daily metrics
    const dailyMetrics = await this.analyticsMetricRepository.find({
      where: {
        aggregation: MetricAggregation.DAY,
        timestamp: Between(dateFrom, dateTo),
      },
      order: { timestamp: 'ASC' },
    });

    const expectedDays = Math.ceil(
      (dateTo.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000),
    );

    const actualDays = new Set(
      dailyMetrics.map(m => m.timestamp.toISOString().split('T')[0]),
    ).size;

    const missingDays = expectedDays - actualDays;

    return {
      type: 'missing',
      severity: missingDays > 7 ? 'high' : missingDays > 0 ? 'medium' : 'low',
      description: `Missing ${missingDays} days of data out of ${expectedDays} expected`,
      affectedRecords: missingDays,
    };
  }

  private async checkDuplicates(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<DataQualityIssue> {
    const duplicates = await this.analyticsMetricRepository
      .createQueryBuilder('metric')
      .select([
        'metric.metricType',
        'metric.aggregation',
        'metric.timestamp',
        'metric.assetCode',
        'COUNT(*) as count',
      ])
      .where('metric.timestamp BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .groupBy('metric.metricType, metric.aggregation, metric.timestamp, metric.assetCode')
      .having('COUNT(*) > 1')
      .getRawMany();

    return {
      type: 'duplicate',
      severity: duplicates.length > 10 ? 'high' : duplicates.length > 0 ? 'medium' : 'low',
      description: `Found ${duplicates.length} duplicate metric entries`,
      affectedRecords: duplicates.reduce((sum, d) => sum + parseInt(d.count) - 1, 0),
    };
  }

  private async checkInvalidValues(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<DataQualityIssue> {
    const invalidCount = await this.analyticsMetricRepository
      .createQueryBuilder('metric')
      .where('metric.timestamp BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .andWhere("(metric.value IS NULL OR metric.value = '' OR CAST(metric.value AS NUMERIC) IS NULL)")
      .getCount();

    return {
      type: 'invalid',
      severity: invalidCount > 100 ? 'high' : invalidCount > 0 ? 'medium' : 'low',
      description: `Found ${invalidCount} records with invalid values`,
      affectedRecords: invalidCount,
    };
  }
}
