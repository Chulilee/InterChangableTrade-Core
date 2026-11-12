import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@app/common';

export class QueryTradeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Asset code filter', example: 'USDC' })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({
    description: 'User ID involved in the trade (maker or taker)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
