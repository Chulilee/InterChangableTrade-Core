import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/common';

export class QueryAssetDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by asset code.' })
  @IsOptional()
  @IsString()
  code?: string;
}
