import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { AuditCategory, AuditOutcome } from '../entities/audit-log.entity';

/**
 * Filters for searching the audit trail. All fields are optional and combine
 * with AND semantics; `from`/`to` bound the `createdAt` range.
 */
export class QueryAuditLogDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by acting user id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ enum: AuditCategory })
  @IsOptional()
  @IsEnum(AuditCategory)
  category?: AuditCategory;

  @ApiPropertyOptional({ description: 'Filter by action, e.g. "user.login"' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ enum: AuditOutcome })
  @IsOptional()
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional({ description: 'Filter by resource type, e.g. "trade"' })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({ description: 'Filter by a specific resource id' })
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ description: 'Start of range (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'End of range (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
