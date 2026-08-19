import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../audit.service';
import { AuditCategory, AuditOutcome } from '../entities/audit-log.entity';

function buildContext(
  req: Record<string, unknown>,
  res: Record<string, unknown> = { statusCode: 200 },
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    audit = { record: jest.fn() };
    interceptor = new AuditInterceptor(audit as unknown as AuditService);
  });

  it('records a SUCCESS entry with derived resource and duration on completion', async () => {
    const ctx = buildContext({
      method: 'GET',
      originalUrl: '/api/trades/abcdef123456',
      user: { id: 'user-1', role: 'user' },
      headers: { 'user-agent': 'jest', 'x-request-id': 'req-9' },
      ip: '10.0.0.1',
      params: { id: 'abcdef123456' },
    });
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.outcome).toBe(AuditOutcome.SUCCESS);
    expect(entry.userId).toBe('user-1');
    expect(entry.resourceType).toBe('trades');
    expect(entry.resourceId).toBe('abcdef123456');
    expect(entry.statusCode).toBe(200);
    expect(typeof entry.durationMs).toBe('number');
    // id-looking segment is normalized in the grouped action
    expect(entry.action).toBe('GET /api/trades/:id');
  });

  it('classifies auth routes as SECURITY events', async () => {
    const ctx = buildContext({
      method: 'POST',
      originalUrl: '/auth/login',
      headers: {},
    });
    const next: CallHandler = { handle: () => of({}) };

    await lastValueFrom(interceptor.intercept(ctx, next));
    expect(audit.record.mock.calls[0][0].category).toBe(AuditCategory.SECURITY);
  });

  it('records a FAILURE entry and rethrows when the handler errors', async () => {
    const ctx = buildContext({
      method: 'DELETE',
      originalUrl: '/api/wallet/1',
      headers: {},
    });
    const next: CallHandler = {
      handle: () => throwError(() => ({ status: 403, message: 'forbidden' })),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, next)),
    ).rejects.toEqual({
      status: 403,
      message: 'forbidden',
    });
    const entry = audit.record.mock.calls[0][0];
    expect(entry.outcome).toBe(AuditOutcome.FAILURE);
    expect(entry.statusCode).toBe(403);
    // a 403 is escalated to a security event regardless of route
    expect(entry.category).toBe(AuditCategory.SECURITY);
  });

  it('skips non-http contexts', async () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('passthrough') };
    const out = await lastValueFrom(interceptor.intercept(ctx, next));
    expect(out).toBe('passthrough');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
