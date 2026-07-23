import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { QueryOptimizerService } from './query-optimizer.service';
import { PaginationQueryDto } from '@app/common';

describe('QueryOptimizerService', () => {
  let service: QueryOptimizerService;
  let mockRepository: jest.Mocked<Repository<any>>;

  beforeEach(async () => {
    mockRepository = {
      createQueryBuilder: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [QueryOptimizerService],
    }).compile();

    service = module.get(QueryOptimizerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildOptimizedQuery', () => {
    it('should build a basic query with pagination', () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        getCount: jest.fn(),
      };

      mockRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const query: PaginationQueryDto = { page: 2, limit: 10 };
      const result = service.buildOptimizedQuery(mockRepository, query);

      expect(result.queryBuilder).toBeDefined();
      expect(result.countQuery).toBeDefined();
      expect(mockQb.skip).toHaveBeenCalledWith(10);
      expect(mockQb.take).toHaveBeenCalledWith(10);
    });

    it('should apply search filters when provided', () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        getCount: jest.fn(),
      };

      mockRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const query: PaginationQueryDto = { page: 1, limit: 20, search: 'test' };
      const result = service.buildOptimizedQuery(mockRepository, query, {
        searchFields: ['name', 'email'],
      });

      expect(result.queryBuilder).toBeDefined();
      expect(mockQb.andWhere).toHaveBeenCalled();
    });

    it('should apply date range filters', () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        getCount: jest.fn(),
      };

      mockRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const query: PaginationQueryDto = { page: 1, limit: 20 };
      const result = service.buildOptimizedQuery(mockRepository, query, {
        dateRange: { start: new Date('2024-01-01'), end: new Date('2024-12-31') },
      });

      expect(result.queryBuilder).toBeDefined();
      expect(mockQb.andWhere).toHaveBeenCalledTimes(2);
    });

    it('should apply custom sort', () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
        getCount: jest.fn(),
      };

      mockRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const query: PaginationQueryDto = { page: 1, limit: 20 };
      const result = service.buildOptimizedQuery(mockRepository, query, {
        sort: { field: 'name', direction: 'ASC' },
      });

      expect(mockQb.orderBy).toHaveBeenCalledWith('entity.name', 'ASC');
    });
  });

  describe('analyzeQueryPattern', () => {
    it('should suggest indexes for frequently accessed columns', () => {
      const queries = [
        'SELECT * FROM users WHERE users.email = $1',
        'SELECT * FROM users WHERE users.email = $1 AND users.status = $2',
        'SELECT * FROM orders WHERE orders.userId = $1',
      ];

      const suggestions = service.analyzeQueryPattern(queries);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.column === 'email')).toBe(true);
    });
  });
});
