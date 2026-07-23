import { Injectable, Logger } from '@nestjs/common';
import { Repository, SelectQueryBuilder, Brackets } from 'typeorm';
import { PaginationQueryDto, PaginatedResultDto } from '@app/common';

export interface FilterOptions {
  searchFields?: string[];
  dateRange?: { start?: Date; end?: Date };
  sort?: { field: string; direction: 'ASC' | 'DESC' };
}

@Injectable()
export class QueryOptimizerService {
  private readonly logger = new Logger(QueryOptimizerService.name);

  buildOptimizedQuery<T extends object>(
    repository: Repository<T>,
    query: PaginationQueryDto,
    filterOptions: FilterOptions = {},
  ): { queryBuilder: SelectQueryBuilder<T>; countQuery: SelectQueryBuilder<T> } {
    const qb = repository.createQueryBuilder('entity');
    const countQb = repository.createQueryBuilder('entity');

    qb.select('entity');

    if (filterOptions.searchFields?.length) {
      qb.andWhere(
        new Brackets((qb2) => {
          filterOptions.searchFields!.forEach((field) => {
            qb2.orWhere(`LOWER(entity.${field}) LIKE LOWER(:search)`, {
              search: `%${query.search ?? ''}%`,
            });
          });
        }),
      );
    }

    if (filterOptions.dateRange) {
      if (filterOptions.dateRange.start) {
        qb.andWhere('entity.createdAt >= :start', {
          start: filterOptions.dateRange.start,
        });
      }
      if (filterOptions.dateRange.end) {
        qb.andWhere('entity.createdAt <= :end', {
          end: filterOptions.dateRange.end,
        });
      }
    }

    const sortField = filterOptions.sort?.field ?? 'createdAt';
    const sortDirection = filterOptions.sort?.direction ?? 'DESC';
    qb.orderBy(`entity.${sortField}`, sortDirection);

    const skip = ((query.page ?? 1) - 1) * (query.limit ?? 20);
    qb.skip(skip).take(query.limit ?? 20);

    return { queryBuilder: qb, countQuery: countQb };
  }

  async executePaginatedQuery<T extends object>(
    repository: Repository<T>,
    query: PaginationQueryDto,
    filterOptions: FilterOptions = {},
  ): Promise<PaginatedResultDto<T>> {
    const { queryBuilder, countQuery } = this.buildOptimizedQuery(
      repository,
      query,
      filterOptions,
    );

    const [data, total] = await Promise.all([
      queryBuilder.getMany(),
      countQuery.getCount(),
    ]);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedResultDto(data, total, page, limit);
  }

  analyzeQueryPattern(
    queries: string[],
  ): { table: string; column: string; reason: string }[] {
    const suggestions: { table: string; column: string; reason: string }[] = [];

    const tableColumnRegex = /(?:where|order by|join|on)\s+(\w+)\.(\w+)/gi;

    const columnFrequency = new Map<string, number>();

    for (const query of queries) {
      let match;
      while ((match = tableColumnRegex.exec(query)) !== null) {
        const key = `${match[1]}.${match[2]}`;
        columnFrequency.set(key, (columnFrequency.get(key) || 0) + 1);
      }
    }

    for (const [key, count] of columnFrequency.entries()) {
      if (count >= 3) {
        const [table, column] = key.split('.');
        suggestions.push({
          table,
          column,
          reason: `Column appears in ${count} queries - consider adding index`,
        });
      }
    }

    return suggestions;
  }
}
