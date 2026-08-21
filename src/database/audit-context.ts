import { AsyncLocalStorage } from 'async_hooks';

export interface AuditActor {
  id: string;
}

/**
 * Request-scoped holder of the current audit actor. The
 * {@link ActorContextInterceptor} seeds it from `request.user` and the
 * {@link AuditTrailSubscriber} reads it when persisting trail records.
 *
 * `AsyncLocalStorage` keeps the value available across async boundaries
 * without threading it through every service signature.
 */
export class AuditContextService {
  private static readonly storage = new AsyncLocalStorage<AuditActor>();

  /** Runs `fn` with `actor` bound to everything it schedules. */
  static run<T>(actor: AuditActor | undefined, fn: () => T): T {
    return this.storage.run(actor ?? { id: 'system' }, fn);
  }

  /** Current actor, or `system` when called outside a request context. */
  static getActor(): AuditActor {
    return this.storage.getStore() ?? { id: 'system' };
  }
}
