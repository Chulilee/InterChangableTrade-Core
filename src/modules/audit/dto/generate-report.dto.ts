import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * The compliance report kinds the module can produce. Each selects a different
 * slice of the audit trail.
 */
export enum ComplianceReportType {
  /** All transaction/trade related activity in the window. */
  TRANSACTIONS = 'transactions',
  /** Everything a given user did in the window. */
  USER_ACTIVITY = 'user_activity',
  /** Every admin action in the window. */
  ADMIN_ACTIONS = 'admin_actions',
  /** Security-relevant events (auth failures, forbidden access, etc.). */
  SECURITY = 'security',
}

export enum ReportFormat {
  CSV = 'csv',
  PDF = 'pdf',
  JSON = 'json',
}

/**
 * Parameters for {@link ComplianceReportType} generation. `from`/`to` bound the
 * reporting window; `userId` is required only for a `user_activity` report.
 */
export class GenerateReportDto {
  @ApiProperty({ enum: ComplianceReportType })
  @IsEnum(ComplianceReportType)
  type: ComplianceReportType;

  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.CSV })
  @IsOptional()
  @IsEnum(ReportFormat)
  format: ReportFormat = ReportFormat.CSV;

  @ApiPropertyOptional({
    description: 'Start of the reporting window (ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of the reporting window (ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'Target user id (required for a user_activity report)',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Optional free-text title for the report',
  })
  @IsOptional()
  @IsString()
  title?: string;
}
