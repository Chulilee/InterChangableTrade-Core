import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { RateLimitGuard, hashApiKey } from './rate-limit.guard';
import { RATE_LIMIT_BYPASS_KEY } from '../decorators/bypass-rate-limit.decorator';
import { RATE_LIMIT_CONFIG_KEY } from '../decorators/rate-limit-config.decorator';
import { RateLimitTier } from '../enums/rate-limit.enum';

// -------------------------------------------------------
//  Mocks
// -------------------------------------------------------
function createRequest(overrides: Record<string, any> = {}) {
  return {
    path: '/api/test',
    ip: '127.0.0.1',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as any;
}

function createResponse() {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    get headers() {
      return headers;
    },
  } as any;
}

const rateLimitServiceMock = {
  check: jest.fn(async () => ({
    allowed: true,
    limit: 100,
    remaining: 95,
    resetSeconds: 60,
    retryAfterSeconds: 0,
  })),
};

function createContext(req?: any): ExecutionContext {
  const request = createRequest(req);
  const response = createResponse();
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as any;
}

// -------------------------------------------------------
//  Tests
// -------------------------------------------------------
describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    rateLimitServiceMock.check.mockClear();
    rateLimitServiceMock.check.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 95,
      resetSeconds: 60,
      retryAfterSeconds: 0,
    });
    guard = new RateLimitGuard(reflector, rateLimitServiceMock as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------
  //  Bypass
  // -------------------------------------------------------
  describe('Bypass decorator', () => {
    it('should allow request when @BypassRateLimit() is set', async () => {
      const context = createContext();
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === RATE_LIMIT_BYPASS_KEY) return true;
          return undefined;
        });

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
      expect(rateLimitServiceMock.check).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  //  Key extraction
  // -------------------------------------------------------
  describe('Key extraction', () => {
    it('should extract IP for unauthenticated requests', async () => {
      const context = createContext({ headers: {} });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'ip:127.0.0.1',
        RateLimitTier.FREE,
        '/api/test',
      );
    });

    it('should extract user ID for authenticated requests', async () => {
      const context = createContext({
        user: { id: 'user-123', role: 'user' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'user:user-123',
        RateLimitTier.FREE,
        '/api/test',
      );
    });

    it('should hash the API key instead of embedding the raw secret', async () => {
      const rawKey = 'ict_super-secret-key-value';
      const context = createContext({
        headers: { 'x-api-key': rawKey },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);

      const expected = createHash('sha256')
        .update(rawKey)
        .digest('hex')
        .slice(0, 32);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        `apikey:${expected}`,
        RateLimitTier.FREE,
        '/api/test',
      );
      expect(rateLimitServiceMock.check).not.toHaveBeenCalledWith(
        `apikey:${rawKey}`,
        expect.anything(),
        expect.anything(),
      );
    });

    it('should expose hashApiKey as a stable, one-way 32-char digest', () => {
      const rawKey = 'ict_another-secret';
      const first = hashApiKey(rawKey);

      expect(first).toHaveLength(32);
      expect(first).toBe(hashApiKey(rawKey));
      expect(first).not.toContain(rawKey);
      expect(first).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should prefer the authenticated user id over the x-api-key header', async () => {
      const context = createContext({
        user: { id: 'user-42' },
        headers: { 'x-api-key': 'ict_should-be-ignored' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);

      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'user:user-42',
        RateLimitTier.FREE,
        '/api/test',
      );
    });

    it('should prefer the resolved apiKeyId over hashing the header', async () => {
      const context = createContext({
        user: { apiKeyId: 'key-7' },
        headers: { 'x-api-key': 'ict_should-be-ignored' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);

      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'apikey:key-7',
        RateLimitTier.FREE,
        '/api/test',
      );
    });

    it('should ignore a rotating X-Forwarded-For header (same req.ip keeps one bucket)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const first = createContext({
        ip: '203.0.113.9',
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
      const second = createContext({
        ip: '203.0.113.9',
        headers: { 'x-forwarded-for': '10.0.0.2' },
      });

      await guard.canActivate(first);
      await guard.canActivate(second);

      const keys = (rateLimitServiceMock.check.mock.calls as unknown[][]).map(
        (call) => call[0],
      );
      // Both requests resolve to the same bucket even though the header rotated.
      expect(keys).toEqual(['ip:203.0.113.9', 'ip:203.0.113.9']);
    });

    it('should fall back to the socket address when req.ip is unavailable', async () => {
      const context = createContext({
        ip: undefined,
        socket: { remoteAddress: '198.51.100.4' },
        headers: {},
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);

      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'ip:198.51.100.4',
        RateLimitTier.FREE,
        '/api/test',
      );
    });
  });

  // -------------------------------------------------------
  //  Tier detection
  // -------------------------------------------------------
  describe('Tier detection', () => {
    it('should use tier from request.user', async () => {
      const context = createContext({
        user: { id: 'u1', tier: 'premium' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        'user:u1',
        RateLimitTier.PREMIUM,
        expect.any(String),
      );
    });

    it('should ignore spoofed x-user-tier header and default to free tier', async () => {
      const context = createContext({
        headers: { 'x-user-tier': 'enterprise' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        expect.any(String),
        RateLimitTier.FREE,
        expect.any(String),
      );
    });

    it('should default to free tier when no user or header', async () => {
      const context = createContext({ headers: {} });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      expect(rateLimitServiceMock.check).toHaveBeenCalledWith(
        expect.any(String),
        RateLimitTier.FREE,
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------
  //  Response headers
  // -------------------------------------------------------
  describe('Response headers', () => {
    it('should set X-RateLimit-* headers on allowed requests', async () => {
      const context = createContext();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '95');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', '60');
    });

    it('should not set headers when limit is infinite', async () => {
      rateLimitServiceMock.check.mockResolvedValueOnce({
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetSeconds: 0,
        retryAfterSeconds: 0,
      });
      const context = createContext({
        user: { id: 'ent', tier: 'enterprise' },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await guard.canActivate(context);
      const response = context.switchToHttp().getResponse();
      expect(response.setHeader).not.toHaveBeenCalledWith(
        'X-RateLimit-Limit',
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------
  //  429 Too Many Requests
  // -------------------------------------------------------
  describe('Rate limit exceeded', () => {
    it('should throw 429 when limit is exceeded', async () => {
      rateLimitServiceMock.check.mockResolvedValueOnce({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetSeconds: 30,
        retryAfterSeconds: 30,
      });
      const context = createContext();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

      try {
        await guard.canActivate(context);
      } catch (err) {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const body = err.getResponse();
        expect(body.retryAfter).toBe(30);
      }
    });

    it('should set Retry-After header when rate limited', async () => {
      rateLimitServiceMock.check.mockResolvedValueOnce({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetSeconds: 15,
        retryAfterSeconds: 15,
      });
      const context = createContext();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      try {
        await guard.canActivate(context);
      } catch {
        // expected
      }

      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '15');
    });
  });

  // -------------------------------------------------------
  //  Per-route override via decorator
  // -------------------------------------------------------
  describe('Per-route override', () => {
    it('should apply maxRequests override from decorator', async () => {
      rateLimitServiceMock.check.mockResolvedValueOnce({
        allowed: true,
        limit: 100,
        remaining: 98,
        resetSeconds: 60,
        retryAfterSeconds: 0,
      });
      const context = createContext();
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === RATE_LIMIT_CONFIG_KEY) return { maxRequests: 10 };
          return undefined;
        });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);

      const res = context.switchToHttp().getResponse();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    });
  });
});
