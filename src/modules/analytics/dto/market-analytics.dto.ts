import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { MetricAggregation } from '../entities/analytics-metric.entity';

export class GetTradingVolumeDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class GetPriceActionDto {
  @IsString()
  assetCode: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsEnum(MetricAggregation)
  aggregation?: MetricAggregation = MetricAggregation.HOUR;
}

export class GetPriceVolatilityDto {
  @IsString()
  assetCode: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  windowSize?: number = 20;
}

export class GetOrderFlowDto {
  @IsString()
  assetCode: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsEnum(MetricAggregation)
  aggregation?: MetricAggregation = MetricAggregation.HOUR;
}

export class GetMarketMakerPerformanceDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class GetLiquidityDepthDto {
  @IsString()
  assetCode: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}
