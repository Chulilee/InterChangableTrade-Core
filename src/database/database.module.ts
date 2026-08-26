import { Module } from '@nestjs/common';
import { AuditTrailSubscriber } from './audit-trail.subscriber';

/**
 * Persistence infrastructure shared by every feature module:
 * - registers {@link AuditTrailSubscriber} so row changes are captured
 *   automatically (the TypeORM `DataSource` it needs comes from the global
 *   `TypeOrmModule.forRootAsync` registration in `AppModule`).
 *
 * Connection/pool configuration itself lives in `src/config/database.config.ts`.
 */
@Module({
  providers: [AuditTrailSubscriber],
  exports: [AuditTrailSubscriber],
})
export class DatabaseModule {}
