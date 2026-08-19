import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';

/**
 * Comprehensive audit logging & compliance reporting.
 *
 * Registers {@link AuditInterceptor} as a global (`APP_INTERCEPTOR`) so every
 * HTTP request is captured, and exposes {@link AuditService} to other modules
 * that need to append domain-specific audit records (e.g. data-change
 * before/after snapshots) beyond the automatic request capture.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
