import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DatabaseService } from './database.service';
import { MigrationRunnerService } from './migration-runner.service';
import { BackupService, RestoreOptions } from './backup.service';
import { PoolMonitorService } from './pool-monitor.service';

@ApiTags('Database')
@Controller('admin/database')
export class DatabaseController {
  private readonly logger = new Logger(DatabaseController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly migrationRunnerService: MigrationRunnerService,
    private readonly backupService: BackupService,
    private readonly poolMonitorService: PoolMonitorService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Database health check' })
  @ApiResponse({ status: 200, description: 'Database is healthy' })
  async healthCheck() {
    return this.databaseService.healthCheck();
  }

  @Get('migrations/status')
  @ApiOperation({ summary: 'Get migration status' })
  @ApiResponse({ status: 200, description: 'Migration status' })
  async getMigrationStatus() {
    return this.migrationRunnerService.getStatus();
  }

  @Post('migrations/run')
  @ApiOperation({ summary: 'Run pending migrations' })
  @ApiResponse({ status: 200, description: 'Migrations executed' })
  async runMigrations() {
    this.logger.log('Running pending migrations');
    const result = await this.migrationRunnerService.runMigrations();
    return result;
  }

  @Post('migrations/rollback')
  @ApiOperation({ summary: 'Rollback migrations' })
  @ApiResponse({ status: 200, description: 'Migrations rolled back' })
  async rollbackMigrations(@Body('steps') steps: number = 1) {
    this.logger.log(`Rolling back ${steps} migration(s)`);
    const result = await this.migrationRunnerService.rollbackMigration(steps);
    return result;
  }

  @Post('backup')
  @ApiOperation({ summary: 'Create database backup' })
  @ApiResponse({ status: 200, description: 'Backup created' })
  async createBackup() {
    this.logger.log('Creating manual backup');
    return this.backupService.createBackup();
  }

  @Post('restore')
  @ApiOperation({ summary: 'Restore database from backup' })
  @ApiResponse({ status: 200, description: 'Database restored' })
  async restore(@Body() options: RestoreOptions) {
    this.logger.log(`Restoring database from ${options.path}`);
    return this.backupService.restore(options);
  }

  @Get('backups')
  @ApiOperation({ summary: 'List available backups' })
  @ApiResponse({ status: 200, description: 'List of backups' })
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Get('pool/metrics')
  @ApiOperation({ summary: 'Get connection pool metrics' })
  @ApiResponse({ status: 200, description: 'Pool metrics' })
  async getPoolMetrics() {
    return this.poolMonitorService.getDetailedMetrics();
  }

  @Get('pool/recommendations')
  @ApiOperation({ summary: 'Get pool optimization recommendations' })
  async getRecommendations() {
    return {
      metrics: this.poolMonitorService.getCurrentMetrics(),
      recommendations: this.poolMonitorService.getRecommendations(),
    };
  }
}
