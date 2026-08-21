import { FindOptionsOrder, FindOptionsWhere, Repository } from 'typeorm';
import { BaseEntity } from '../entities/base.entity';
import { PaginatedResultDto } from '../dto/paginated-result.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

/**
 * Base class for feature repositories. Adds opinionated pagination on top of
 * the stock TypeORM repository so every list endpoint shares the same
 * envelope ({@link PaginatedResultDto}) and the same 1-based page semantics
 * as {@link PaginationQueryDto}.
 */
export class BaseRepository<T extends BaseEntity> extends Repository<T> {
  /**
   * Returns one page of rows plus pagination metadata. Page is 1-based;
   * limit defaults to 20 and is clamped to [1, 100] to match the shared DTO.
   */
  async findPaginated(
    query: Partial<Pick<PaginationQueryDto, 'page' | 'limit'>> = {},
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    order?: FindOptionsOrder<T>,
  ): Promise<PaginatedResultDto<T>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);

    const [items, total] = await this.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      where,
      order: order ?? ({ createdAt: 'DESC' } as FindOptionsOrder<T>),
    });

    return new PaginatedResultDto(items, total, page, limit);
  }
}
