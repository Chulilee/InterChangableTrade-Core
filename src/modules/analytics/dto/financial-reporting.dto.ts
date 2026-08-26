import {
  IsOptional,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { MetricType } from '../entities/analytics-metric.entity';

export class GetRevenueBreakdownDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetCostAnalysisDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetProfitabilityMetricsDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetForecastDataDto {
  @IsEnum(MetricType)
  metricType: MetricType;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(60)
  historicalMonths?: number = 12;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  forecastMonths?: number = 6;
}
