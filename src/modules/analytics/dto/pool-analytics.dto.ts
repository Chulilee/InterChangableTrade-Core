import { IsOptional, IsString, IsDateString, IsEnum, IsArray, IsUUID } from 'class-validator';
import { MetricAggregation } from '../entities/analytics-metric.entity';

export class GetPoolMetricsDto {
  @IsString()
  poolId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetLpReturnsDto {
  @IsUUID()
  lpId: string;

  @IsString()
  poolId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetFeeCollectionAnalysisDto {
  @IsString()
  poolId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsEnum(MetricAggregation)
  aggregation?: MetricAggregation = MetricAggregation.DAY;
}

export class GetTvlTrendsDto {
  @IsString()
  poolId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsEnum(MetricAggregation)
  aggregation?: MetricAggregation = MetricAggregation.DAY;
}

export class ComparePoolsDto {
  @IsArray()
  @IsString({ each: true })
  poolIds: string[];

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetPoolUtilizationDto {
  @IsString()
  poolId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}
