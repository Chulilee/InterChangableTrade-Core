import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsArray,
  IsBoolean,
  IsObject,
} from 'class-validator';
import {
  MetricType,
  MetricAggregation,
} from '../entities/analytics-metric.entity';
import { ScheduleFrequency } from '../services/scheduled-report.service';

export class StartEtlJobDto {
  @ApiProperty({
    enum: ['blockchain', 'database', 'api'],
    description: 'Source system type for the ETL job',
    example: 'database',
  })
  @IsEnum(['blockchain', 'database', 'api'])
  sourceType: 'blockchain' | 'database' | 'api';

  @ApiPropertyOptional({
    description: 'Optional source connection identifier or URI reference',
    example: 'primary-postgres',
  })
  @IsOptional()
  @IsString()
  sourceConnection?: string;

  @ApiPropertyOptional({
    enum: ['analytics_metrics'],
    description: 'Target dataset for the ETL job',
    default: 'analytics_metrics',
    example: 'analytics_metrics',
  })
  @IsOptional()
  @IsEnum(['analytics_metrics'])
  targetType?: 'analytics_metrics' = 'analytics_metrics';

  @ApiProperty({ description: 'Batch size for processing', minimum: 1, maximum: 1000, example: 100 })
  @IsInt()
  @Min(1)
  @Max(1000)
  batchSize: number;

  @ApiProperty({ description: 'Number of parallel workers', minimum: 1, maximum: 10, example: 2 })
  @IsInt()
  @Min(1)
  @Max(10)
  parallelWorkers: number;

  @ApiPropertyOptional({
    description: 'Optional source-specific filters',
    example: { table: 'trades' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

export class StartBackfillJobDto {
  @ApiProperty({ enum: MetricType, isArray: true, description: 'Metric types to backfill', example: [MetricType.TRADE_VOLUME] })
  @IsArray()
  @IsEnum(MetricType, { each: true })
  metricTypes: MetricType[];

  @ApiProperty({ description: 'Backfill start date (ISO 8601)', example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ description: 'Backfill end date (ISO 8601)', example: '2026-01-31T23:59:59.999Z' })
  @IsDateString()
  dateTo: string;

  @ApiProperty({ enum: MetricAggregation, description: 'Aggregation granularity', example: MetricAggregation.DAY })
  @IsEnum(MetricAggregation)
  aggregation: MetricAggregation;

  @ApiProperty({ description: 'Whether to overwrite existing aggregates in range', example: false })
  @IsBoolean()
  overwrite: boolean;
}

export class StartAggregationJobDto {
  @ApiProperty({ enum: MetricType, isArray: true, description: 'Metric types to aggregate', example: [MetricType.TRADE_VOLUME] })
  @IsArray()
  @IsEnum(MetricType, { each: true })
  metricTypes: MetricType[];

  @ApiProperty({ description: 'Aggregation window start (ISO 8601)', example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ description: 'Aggregation window end (ISO 8601)', example: '2026-01-31T23:59:59.999Z' })
  @IsDateString()
  dateTo: string;
}

export class StartCleanupJobDto {
  @ApiPropertyOptional({
    description: 'Retention period in days (data older than this may be cleaned)',
    minimum: 30,
    maximum: 3650,
    default: 730,
    example: 730,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  retentionDays?: number = 730;
}

export class ScheduleReportDto {
  @ApiProperty({ description: 'Report ID to schedule', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  reportId: string;

  @ApiProperty({ enum: ScheduleFrequency, description: 'Schedule frequency', example: ScheduleFrequency.DAILY })
  @IsEnum(ScheduleFrequency)
  frequency: ScheduleFrequency;

  @ApiPropertyOptional({ description: 'Cron expression (required for custom schedules)', example: '0 0 * * *' })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiProperty({ description: 'Recipient email addresses', type: [String], example: ['ops@example.com'] })
  @IsArray()
  @IsString({ each: true })
  recipients: string[];

  @ApiPropertyOptional({ description: 'Include charts in delivery', example: false })
  @IsOptional()
  @IsBoolean()
  includeCharts?: boolean;

  @ApiPropertyOptional({ description: 'Include summary section', example: true })
  @IsOptional()
  @IsBoolean()
  includeSummary?: boolean;

  @ApiPropertyOptional({
    description: 'Custom report parameters',
    type: 'object',
    additionalProperties: true,
    example: { timezone: 'UTC' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, unknown>;
}

export class RunDataQualityCheckDto {
  @ApiProperty({ description: 'Quality check window start (ISO 8601)', example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ description: 'Quality check window end (ISO 8601)', example: '2026-01-31T23:59:59.999Z' })
  @IsDateString()
  dateTo: string;
}
