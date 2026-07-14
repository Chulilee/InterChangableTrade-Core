import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { ListingStatus } from '../entities/listing.entity';

/**
 * Filters for browsing the marketplace, layered on top of shared pagination.
 */
export class QueryListingDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by asset code, e.g. USDC' })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}
