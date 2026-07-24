import { IsOptional, IsString, IsDateString, IsArray, IsEnum, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { MetricType, MetricAggregation } from '../entities/analytics-metric.entity';

export class QueryMetricsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MetricType)
  metricType?: MetricType;

  @IsOptional()
  @IsEnum(MetricAggregation)
  aggregation?: MetricAggregation;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assetCodes?: string[];

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsArray()
  dimensions?: string[];
}