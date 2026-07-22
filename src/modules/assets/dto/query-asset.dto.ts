import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { AssetStatus } from '../entities/asset.entity';

export class QueryAssetDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by asset code.' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Filter by asset issuer.' })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiPropertyOptional({ description: 'Filter by asset name.' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: AssetStatus,
    description: 'Filter by asset status.',
  })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiPropertyOptional({ description: 'Filter by tradeable status.' })
  @IsOptional()
  @IsBoolean()
  isTradeable?: boolean;
}
