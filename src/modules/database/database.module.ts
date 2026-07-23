import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { TransactionService } from './transaction.service';
import { QueryOptimizerService } from './query-optimizer.service';
import { MigrationRunnerService } from './migration-runner.service';
import { BackupService } from './backup.service';
import { PoolMonitorService } from './pool-monitor.service';
import { AuditTrailService } from './audit-trail.service';
import { DataSource } from 'typeorm';
import { DatabaseController } from './database.controller';

@Module({
  imports: [TypeOrmModule],
  controllers: [DatabaseController],
  providers: [
    DataSource,
    DatabaseService,
    TransactionService,
    QueryOptimizerService,
    MigrationRunnerService,
    BackupService,
    PoolMonitorService,
    AuditTrailService,
  ],
  exports: [
    DatabaseService,
    TransactionService,
    QueryOptimizerService,
    MigrationRunnerService,
    BackupService,
    PoolMonitorService,
    AuditTrailService,
  ],
})
export class DatabaseModule {}
