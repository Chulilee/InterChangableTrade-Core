import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max, IsArray, IsBoolean } from 'class-validator';
import { MetricType, MetricAggregation } from '../entities/analytics-metric.entity';
import { ScheduleFrequency } from '../services/scheduled-report.service';

export class StartEtlJobDto {
  @IsEnum(['blockchain', 'database', 'api'])
  sourceType: 'blockchain' | 'database' | 'api';

  @IsOptional()
  @IsString()
  sourceConnection?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  batchSize: number;

  @IsInt()
  @Min(1)
  @Max(10)
  parallelWorkers: number;

  @IsOptional()
  filters?: Record<string, any>;
}

export class StartBackfillJobDto {
  @IsArray()
  @IsEnum(MetricType, { each: true })
  metricTypes: MetricType[];

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsEnum(MetricAggregation)
  aggregation: MetricAggregation;

  @IsBoolean()
  overwrite: boolean;
}

export class StartAggregationJobDto {
  @IsArray()
  @IsEnum(MetricType, { each: true })
  metricTypes: MetricType[];

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class StartCleanupJobDto {
  @IsInt()
  @Min(30)
  @Max(3650)
  retentionDays?: number = 730;
}

export class ScheduleReportDto {
  @IsString()
  reportId: string;

  @IsEnum(ScheduleFrequency)
  frequency: ScheduleFrequency;

  @IsOptional()
  @IsString()
  cronExpression?: string;

  @IsArray()
  @IsString({ each: true })
  recipients: string[];

  @IsOptional()
  @IsBoolean()
  includeCharts?: boolean;

  @IsOptional()
  @IsBoolean()
  includeSummary?: boolean;

  @IsOptional()
  customParameters?: Record<string, any>;
}

export class RunDataQualityCheckDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}
