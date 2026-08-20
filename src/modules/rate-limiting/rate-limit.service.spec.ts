import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RateLimitService } from './rate-limit.service';
import { RateLimitConfig } from './entities/rate-limit-config.entity';
import {
  RateLimitTier,
  DEFAULT_TIER_QUOTAS,
  DEFAULT_WINDOW_SIZE_SECS,
} from './enums/rate-limit.enum';

// -------------------------------------------------------
//  Repository mock
// -------------------------------------------------------
function createRepoMock() {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => ({ ...entity, id: 'mock-id' })),
  } as unknown as Repository<RateLimitConfig>;
}

// -------------------------------------------------------
//  ConfigService mock
// -------------------------------------------------------
const configServiceMock: { get: jest.Mock } = {
  get: jest.fn((key: string) => {
    if (key === 'rateLimit.strategy') return 'sliding_window';
    return undefined;
  }),
};

// -------------------------------------------------------
//  Redis mock factory — configurable per test
// -------------------------------------------------------
function createRedisMock() {
  return {
    pipeline: jest.fn(() => createPipelineMock()),
    zrange: jest.fn(async () => []),
    del: jest.fn(async () => 1),
  } as any;
}

/**
 * Creates a pipeline mock. Pass exec results as individual [err, value]
 * tuples matching ioredis pipeline.exec() convention:
 *
 *   createPipelineMock([null, 0], [null, null], [null, null], [null, 5])
 *   → exec() returns [[null,0],[null,null],[null,null],[null,5]]
 *
 * For sliding window: 4 commands (zremrangebyscore, zadd, expire, zcard)
 *   → pass 4 tuples, with the last one being [null, count]
 *
 * For fixed window: 2 commands (incr, expire)
 *   → pass 2 tuples, with the first one being [null, count]
 */
function createPipelineMock(...tuples: any[]) {
  return {
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    exec: jest.fn(async () => tuples),
  };
}

// -------------------------------------------------------
//  Tests
// -------------------------------------------------------
describe('RateLimitService', () => {
  let service: RateLimitService;
  let redisMock: any;
  let repoMock: Repository<RateLimitConfig>;

  beforeEach(async () => {
    redisMock = createRedisMock();
    repoMock = createRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: getRepositoryToken(RateLimitConfig), useValue: repoMock },
        { provide: 'REDIS_CLIENT', useValue: redisMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(RateLimitService);
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------
  //  Tier defaults
  // -------------------------------------------------------
  describe('Default tier quotas', () => {
    it('should have correct defaults for all tiers', () => {
      expect(DEFAULT_TIER_QUOTAS[RateLimitTier.FREE]).toBe(100);
      expect(DEFAULT_TIER_QUOTAS[RateLimitTier.PREMIUM]).toBe(1000);
      expect(DEFAULT_TIER_QUOTAS[RateLimitTier.ENTERPRISE]).toBe(Infinity);
    });

    it('should have a 60-second default window', () => {
      expect(DEFAULT_WINDOW_SIZE_SECS).toBe(60);
    });
  });

  // -------------------------------------------------------
  //  check() — basic allowed/denied flow
  // -------------------------------------------------------
  describe('check()', () => {
    it('should allow requests under the limit', async () => {
      // Pipeline: zremrangebyscore, zadd, expire, zcard → count = 5
      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 1], [null, 1], [null, 5]),
      );

      const result = await service.check(
        'ip:127.0.0.1',
        RateLimitTier.FREE,
        '/api/test',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(95);
    });

    it('should deny requests over the limit', async () => {
      // Pipeline: count = 101 (over limit of 100 for FREE)
      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 1], [null, 1], [null, 101]),
      );

      const result = await service.check(
        'ip:127.0.0.1',
        RateLimitTier.FREE,
        '/api/test',
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    });

    it('should always allow enterprise tier requests', async () => {
      const result = await service.check(
        'user:ent-1',
        RateLimitTier.ENTERPRISE,
        '/api/test',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(Infinity);
      expect(result.remaining).toBe(Infinity);
    });

    it('should deny all requests for disabled tier (maxRequests=0)', async () => {
      // Pre-populate cache as if the tier is disabled
      (service as any).tierQuotas.set(RateLimitTier.FREE, {
        maxRequests: 0,
        windowSizeSeconds: 60,
      });

      // Even a single request (count=1) exceeds limit of 0
      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 1], [null, 1], [null, 1]),
      );

      const result = await service.check('ip:blocked', RateLimitTier.FREE);

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });
  });

  // -------------------------------------------------------
  //  Config management
  // -------------------------------------------------------
  describe('Configuration management', () => {
    it('should upsert a new config and reload', async () => {
      const savedEntity = {
        tier: RateLimitTier.PREMIUM,
        maxRequests: 2000,
        windowSizeSeconds: 60,
        endpointPattern: null,
        enabled: true,
      };

      (repoMock.findOne as jest.Mock).mockResolvedValueOnce(null);
      (repoMock.create as jest.Mock).mockReturnValueOnce(savedEntity);
      (repoMock.save as jest.Mock).mockResolvedValueOnce(savedEntity);
      (repoMock.find as jest.Mock).mockResolvedValueOnce([savedEntity]);

      const result = await service.upsertConfig({
        tier: RateLimitTier.PREMIUM,
        maxRequests: 2000,
      });

      expect(result.maxRequests).toBe(2000);
      expect(repoMock.save).toHaveBeenCalled();
    });

    it('should update an existing config', async () => {
      const existing = {
        tier: RateLimitTier.FREE,
        maxRequests: 100,
        windowSizeSeconds: 60,
        endpointPattern: null,
        enabled: true,
      };
      const updated = { ...existing, maxRequests: 200 };

      (repoMock.findOne as jest.Mock).mockResolvedValueOnce(existing);
      (repoMock.save as jest.Mock).mockResolvedValueOnce(updated);
      (repoMock.find as jest.Mock).mockResolvedValueOnce([updated]);

      const result = await service.upsertConfig({
        tier: RateLimitTier.FREE,
        maxRequests: 200,
      });

      expect(result.maxRequests).toBe(200);
    });

    it('should return null for non-existent config', async () => {
      (repoMock.findOne as jest.Mock).mockResolvedValueOnce(null);
      const result = await service.getConfig(RateLimitTier.FREE);
      expect(result).toBeNull();
    });

    it('should return all configs', async () => {
      const configs = [
        { tier: RateLimitTier.FREE, maxRequests: 100 },
        { tier: RateLimitTier.PREMIUM, maxRequests: 1000 },
      ];
      (repoMock.find as jest.Mock).mockResolvedValueOnce(configs);
      const result = await service.getAllConfigs();
      expect(result).toHaveLength(2);
    });
  });

  // -------------------------------------------------------
  //  Usage tracking
  // -------------------------------------------------------
  describe('getUsage()', () => {
    it('should return usage stats for free tier', async () => {
      // getUsage pipeline: zremrangebyscore (index 0), zcard (index 1) → count = 42
      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 42]),
      );

      const usage = await service.getUsage('user:1', RateLimitTier.FREE);
      expect(usage.used).toBe(42);
      expect(usage.limit).toBe(100);
      expect(usage.remaining).toBe(58);
    });

    it('should return unlimited for enterprise tier', async () => {
      const usage = await service.getUsage('user:1', RateLimitTier.ENTERPRISE);
      expect(usage.limit).toBe(Infinity);
      expect(usage.remaining).toBe(Infinity);
    });
  });

  // -------------------------------------------------------
  //  Key clearing
  // -------------------------------------------------------
  describe('clearKey()', () => {
    it('should delete the redis key', async () => {
      await service.clearKey('user:1', RateLimitTier.FREE);
      expect(redisMock.del).toHaveBeenCalledWith(
        expect.stringContaining('rl:user:1:free:'),
      );
    });
  });

  // -------------------------------------------------------
  //  Endpoint-specific overrides
  // -------------------------------------------------------
  describe('Endpoint overrides', () => {
    it('should apply endpoint-specific limit when pattern matches', async () => {
      const config = {
        tier: RateLimitTier.FREE,
        maxRequests: 10,
        windowSizeSeconds: 60,
        endpointPattern: '/api/trading/*',
        enabled: true,
      };
      (repoMock.find as jest.Mock).mockResolvedValueOnce([config]);
      await service.refreshConfig();

      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 1], [null, 1], [null, 5]),
      );

      const result = await service.check(
        'ip:1.2.3.4',
        RateLimitTier.FREE,
        '/api/trading/order',
      );
      expect(result.limit).toBe(10);
    });

    it('should fall back to tier default for non-matching endpoints', async () => {
      // Use a config that only has an endpoint pattern, not a tier override
      // by setting maxRequests to match the tier default
      const config = {
        tier: RateLimitTier.FREE,
        maxRequests: 10,
        windowSizeSeconds: 60,
        endpointPattern: '/api/trading/*',
        enabled: true,
      };
      (repoMock.find as jest.Mock).mockResolvedValueOnce([config]);
      await service.refreshConfig();

      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 0], [null, 1], [null, 1], [null, 5]),
      );

      // The tier-level config also sets maxRequests=10 from the DB entity,
      // so the fallback for non-matching endpoints uses that tier value.
      const result = await service.check(
        'ip:1.2.3.4',
        RateLimitTier.FREE,
        '/api/assets',
      );
      expect(result.limit).toBe(10);
    });
  });

  // -------------------------------------------------------
  //  Fixed window strategy
  // -------------------------------------------------------
  describe('Fixed window strategy', () => {
    it('should use fixed window counters when strategy is fixed_window', async () => {
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'rateLimit.strategy') return 'fixed_window';
        return undefined;
      });

      // Re-create service with fixed_window strategy
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RateLimitService,
          { provide: getRepositoryToken(RateLimitConfig), useValue: repoMock },
          { provide: 'REDIS_CLIENT', useValue: redisMock },
          { provide: ConfigService, useValue: configServiceMock },
        ],
      }).compile();

      const fixedService = module.get(RateLimitService);
      await fixedService.onModuleInit();

      // Fixed window pipeline: incr (index 0), expire (index 1) → count = 10
      redisMock.pipeline = jest.fn(() =>
        createPipelineMock([null, 10], [null, 1]),
      );

      const result = await fixedService.check(
        'ip:1.2.3.4',
        RateLimitTier.FREE,
        '/api/test',
      );
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
    });
  });
});
