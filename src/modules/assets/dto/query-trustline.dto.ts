import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginatedResultDto, PaginationQueryDto } from '@app/common';

export class QueryTrustlineDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  user?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  asset?: string;
}
