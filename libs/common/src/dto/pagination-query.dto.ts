import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Upper bound for `page`, so a client cannot request an unbounded offset. */
export const MAX_PAGE = 10_000;

/**
 * Reusable pagination query for list endpoints. `page` is 1-based.
 *
 * Query parameters arrive as strings, so `@Type(() => Number)` is required for
 * `@IsInt()` to accept them (see issue #94).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: MAX_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
