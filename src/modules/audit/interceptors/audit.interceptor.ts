import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AuditCategory, AuditOutcome } from '../entities/audit-log.entity';

interface RequestUser {
  id?: string;
  role?: string;
}

interface AuditableRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: string };
  params?: Record<string, string>;
  ip?: string;
  user?: RequestUser;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Global interceptor that writes an immutable audit record for every HTTP
 * request once it completes (success or failure). It records who did what, to
 * which resource, with what outcome and how long it took.
 *
 * Persistence is delegated to {@link AuditService.record}, which does not block
 * the response, so the audit trail is captured without adding meaningful
 * latency to the request it observes.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuditableRequest>();
    const startedAt = Date.now();

    const method = req.method ?? 'UNKNOWN';
    const path = req.originalUrl ?? req.url ?? req.route?.path ?? '';
    const user = req.user;
    const requestId = this.headerValue(req, 'x-request-id');
    const ipAddress = this.headerValue(req, 'x-forwarded-for') ?? req.ip;
    const userAgent = this.headerValue(req, 'user-agent');
    const { resourceType, resourceId } = this.deriveResource(path, req.params);

    const base = {
      action: `${method} ${this.normalizePath(path)}`,
      category: this.deriveCategory(method, path),
      userId: user?.id ?? null,
      userRole: user?.role ?? null,
      resourceType,
      resourceId,
      httpMethod: method,
      path,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      requestId: requestId ?? null,
    };

    return next.handle().pipe(
      tap(() => {
        this.auditService.record({
          ...base,
          outcome: AuditOutcome.SUCCESS,
          statusCode:
            http.getResponse<{ statusCode?: number }>()?.statusCode ?? 200,
          durationMs: Date.now() - startedAt,
        });
      }),
      catchError((err: unknown) => {
        const statusCode =
          typeof err === 'object' && err !== null && 'status' in err
            ? Number((err as { status: unknown }).status) || 500
            : 500;
        this.auditService.record({
          ...base,
          category:
            statusCode === 401 || statusCode === 403
              ? AuditCategory.SECURITY
              : base.category,
          outcome: AuditOutcome.FAILURE,
          statusCode,
          durationMs: Date.now() - startedAt,
        });
        return throwError(() => err);
      }),
    );
  }

  private headerValue(req: AuditableRequest, name: string): string | undefined {
    const raw = req.headers?.[name];
    if (Array.isArray(raw)) {
      return raw[0];
    }
    return raw ?? undefined;
  }

  /**
   * Infer a coarse category from the request. Auth endpoints are security
   * events; mutating verbs are data changes; everything else is a plain user
   * action (or system read).
   */
  private deriveCategory(method: string, path: string): AuditCategory {
    if (/\/auth\b/.test(path)) {
      return AuditCategory.SECURITY;
    }
    if (/\/admin\b/.test(path)) {
      return AuditCategory.ADMIN_ACTION;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return AuditCategory.DATA_CHANGE;
    }
    return AuditCategory.USER_ACTION;
  }

  /**
   * Best-effort resource extraction: the first path segment after an optional
   * `/api` prefix is the resource type, and a trailing id-looking segment is
   * the resource id.
   */
  private deriveResource(
    path: string,
    params?: Record<string, string>,
  ): { resourceType: string | null; resourceId: string | null } {
    const cleaned = path.split('?')[0].replace(/^\/?(api\/)?/, '');
    const segments = cleaned.split('/').filter(Boolean);
    const resourceType = segments[0] ?? null;
    const resourceId =
      params?.id ??
      (segments[1] && /[0-9a-fA-F-]{6,}/.test(segments[1])
        ? segments[1]
        : null);
    return { resourceType, resourceId };
  }

  /** Replace id-looking path segments with `:id` so actions group cleanly. */
  private normalizePath(path: string): string {
    return path
      .split('?')[0]
      .split('/')
      .map((seg) =>
        /^[0-9a-fA-F-]{8,}$/.test(seg) || /^\d+$/.test(seg) ? ':id' : seg,
      )
      .join('/');
  }
}
