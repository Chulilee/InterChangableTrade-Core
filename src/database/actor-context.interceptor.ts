import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditContextService } from './audit-context';

/**
 * Binds the authenticated request user to {@link AuditContextService} for the
 * duration of the handler, so the {@link AuditTrailSubscriber} can attribute
 * row changes to an actor without any service-layer plumbing.
 */
@Injectable()
export class ActorContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user as { id?: string } | undefined;

    // Subscribe *inside* run() so every async continuation of the handler
    // inherits the actor context.
    return new Observable<unknown>((subscriber) =>
      AuditContextService.run(
        user ? { id: String(user.id) } : undefined,
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}
