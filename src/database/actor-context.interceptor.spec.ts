import { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { ActorContextInterceptor } from './actor-context.interceptor';
import { AuditContextService } from './audit-context';

/**
 * Verifies the interceptor binds the request user so code running downstream
 * (including TypeORM subscribers) resolves the right audit actor.
 */
describe('ActorContextInterceptor', () => {
  const buildContext = (request: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it('binds the authenticated user id', async () => {
    let seen: string | undefined;
    const interceptor = new ActorContextInterceptor();

    const result$ = interceptor.intercept(buildContext({ user: { id: 'u42' } }), {
      handle: () =>
        new Observable<unknown>((subscriber) => {
          seen = AuditContextService.getActor().id;
          subscriber.next('ok');
          subscriber.complete();
        }),
    } as never);

    await firstValueFrom(result$ as Observable<unknown>);
    expect(seen).toBe('u42');
  });

  it('falls back to the system actor for unauthenticated requests', async () => {
    let seen: string | undefined;
    const interceptor = new ActorContextInterceptor();

    const result$ = interceptor.intercept(buildContext({}), {
      handle: () =>
        new Observable<unknown>((subscriber) => {
          seen = AuditContextService.getActor().id;
          subscriber.next('ok');
          subscriber.complete();
        }),
    } as never);

    await firstValueFrom(result$ as Observable<unknown>);
    expect(seen).toBe('system');
  });
});
