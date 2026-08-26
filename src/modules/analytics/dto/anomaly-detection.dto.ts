import { IsOptional, IsDateString, IsEnum, IsArray, IsUUID } from 'class-validator';
import { AnomalyType, AnomalySeverity } from '../services/anomaly-detection.service';

export class DetectAnomaliesDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsArray()
  @IsEnum(AnomalyType, { each: true })
  types?: AnomalyType[];

  @IsOptional()
  @IsEnum(AnomalySeverity)
  minSeverity?: AnomalySeverity;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  assetCode?: string;
}

export class GetAnomalyStatisticsDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}
