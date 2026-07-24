import { IsNotEmpty, IsOptional, IsString, IsDateString, IsArray, IsEnum, IsBoolean } from 'class-validator';
import { ReportType, ReportFormat } from '../entities/saved-report.entity';

export class GenerateReportDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsEnum(ReportType)
  reportType: ReportType;

  @IsNotEmpty()
  @IsEnum(ReportFormat)
  format: ReportFormat;

  @IsNotEmpty()
  @IsDateString()
  dateFrom: string;

  @IsNotEmpty()
  @IsDateString()
  dateTo: string;

  @IsOptional()
  filters?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  metrics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensions?: string[];

  @IsOptional()
  @IsBoolean()
  isScheduled?: boolean;

  @IsOptional()
  @IsString()
  scheduleCron?: string;
}