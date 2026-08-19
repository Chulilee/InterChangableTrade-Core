import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from './database.module';
import { DatabaseService } from './database.service';
import { TransactionService } from './transaction.service';
import { QueryOptimizerService } from './query-optimizer.service';
import { MigrationRunnerService } from './migration-runner.service';
import { BackupService } from './backup.service';
import { PoolMonitorService } from './pool-monitor.service';
import { AuditTrailService } from './audit-trail.service';
import { ShardManagerService } from './sharding/shard-manager.service';

describe('DatabaseModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should compile successfully', () => {
    expect(module).toBeDefined();
  });

  it('should provide DatabaseService', () => {
    const service = module.get(DatabaseService);
    expect(service).toBeDefined();
  });

  it('should provide TransactionService', () => {
    const service = module.get(TransactionService);
    expect(service).toBeDefined();
  });

  it('should provide QueryOptimizerService', () => {
    const service = module.get(QueryOptimizerService);
    expect(service).toBeDefined();
  });

  it('should provide MigrationRunnerService', () => {
    const service = module.get(MigrationRunnerService);
    expect(service).toBeDefined();
  });

  it('should provide BackupService', () => {
    const service = module.get(BackupService);
    expect(service).toBeDefined();
  });

  it('should provide PoolMonitorService', () => {
    const service = module.get(PoolMonitorService);
    expect(service).toBeDefined();
  });

  it('should provide AuditTrailService', () => {
    const service = module.get(AuditTrailService);
    expect(service).toBeDefined();
  });

  it('should provide ShardManagerService', () => {
    const service = module.get(ShardManagerService);
    expect(service).toBeDefined();
  });
});
