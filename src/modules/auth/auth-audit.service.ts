import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthAuditLog, AuthEventType } from './entities/auth-audit-log.entity';

export interface AuditContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  success?: boolean;
  failureReason?: string;
}

/**
 * Records every authentication event into an immutable audit log.
 * Errors during write are swallowed so audit failures never interrupt auth
 * flows — they are only logged to the application logger.
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(
    @InjectRepository(AuthAuditLog)
    private readonly auditRepo: Repository<AuthAuditLog>,
  ) {}

  async record(eventType: AuthEventType, ctx: AuditContext): Promise<void> {
    try {
      const entry = this.auditRepo.create({
        userId: ctx.userId,
        eventType,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: ctx.metadata,
        success: ctx.success ?? true,
        failureReason: ctx.failureReason,
      });
      await this.auditRepo.save(entry);
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for event ${eventType}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Convenience helpers -------------------------------------------------- */

  recordSuccess(eventType: AuthEventType, ctx: Omit<AuditContext, 'success'>) {
    return this.record(eventType, { ...ctx, success: true });
  }

  recordFailure(
    eventType: AuthEventType,
    ctx: Omit<AuditContext, 'success'>,
    failureReason: string,
  ) {
    return this.record(eventType, {
      ...ctx,
      success: false,
      failureReason,
    });
  }
}
