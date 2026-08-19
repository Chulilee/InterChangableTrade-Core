import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface BackupOptions {
  format?: 'custom' | 'plain' | 'directory' | 'tar';
  compress?: boolean;
  includeData?: boolean;
  includeSchema?: boolean;
  tables?: string[];
}

export interface BackupResult {
  path: string;
  sizeBytes: number;
  createdAt: Date;
  checksum: string;
}

export interface RestoreOptions {
  path: string;
  dryRun?: boolean;
  dropExisting?: boolean;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;
  private readonly retentionDays: number;
  private readonly intervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    this.backupDir = process.env.BACKUP_DIR || '/tmp/backups';
    this.retentionDays = configService.get('database.backupRetentionDays') || 7;
    this.intervalMs =
      (configService.get('database.backupIntervalMin') || 60) * 60 * 1000;
  }

  startAutomatedBackup(): void {
    if (!this.configService.get('database.backupEnabled')) {
      this.logger.log('Automated backups are disabled');
      return;
    }

    this.intervalHandle = setInterval(async () => {
      try {
        await this.createBackup();
        await this.cleanupOldBackups();
      } catch (error) {
        this.logger.error('Automated backup failed', error);
      }
    }, this.intervalMs);

    this.logger.log(
      `Automated backups started (interval: ${this.intervalMs / 1000 / 60}min)`,
    );
  }

  stopAutomatedBackup(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('Automated backups stopped');
    }
  }

  async createBackup(options: BackupOptions = {}): Promise<BackupResult> {
    const {
      format = 'custom',
      compress = true,
      includeData = true,
      includeSchema = true,
    } = options;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup-${timestamp}.${compress ? 'gz' : 'sql'}`;
    const filePath = path.join(this.backupDir, fileName);

    this.ensureBackupDirExists();

    const dbConfig = this.configService.get('database');
    const env = {
      PGPASSWORD: dbConfig.password,
    };

    const args: string[] = [
      '-h',
      dbConfig.host,
      '-p',
      String(dbConfig.port),
      '-U',
      dbConfig.username,
      '-d',
      dbConfig.name,
      '-F',
      format === 'custom' ? 'c' : format === 'plain' ? 'p' : 't',
      '-f',
      filePath,
    ];

    if (compress && format === 'plain') {
      args.push('-Z', '9');
    }

    if (!includeData) {
      args.push('-s');
    }

    if (!includeSchema) {
      args.push('-a');
    }

    try {
      this.logger.log(`Starting backup to ${filePath}`);
      await execAsync(`pg_dump ${args.map((a) => `"${a}"`).join(' ')}`, {
        env: { ...process.env, ...env },
        maxBuffer: 1024 * 1024 * 1024,
      });

      const stats = fs.statSync(filePath);
      const checksum = await this.calculateChecksum(filePath);

      this.logger.log(
        `Backup completed: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
      );

      return {
        path: filePath,
        sizeBytes: stats.size,
        createdAt: new Date(),
        checksum,
      };
    } catch (error) {
      this.logger.error('Backup failed', error);
      throw new Error(`Backup failed: ${(error as Error).message}`);
    }
  }

  async restore(options: RestoreOptions): Promise<{ rowsAffected: number }> {
    const { path: backupPath, dryRun = false, dropExisting = false } = options;

    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const dbConfig = this.configService.get('database');
    const env = {
      PGPASSWORD: dbConfig.password,
    };

    try {
      if (dropExisting && !dryRun) {
        this.logger.warn('Dropping all tables before restore');
        await execAsync(
          `psql -h "${dbConfig.host}" -p ${dbConfig.port} -U "${dbConfig.username}" -d "${dbConfig.name}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
          { env: { ...process.env, ...env } },
        );
      }

      if (dryRun) {
        this.logger.log(`Dry run: validating backup ${backupPath}`);
        const { stdout } = await execAsync(
          `pg_restore -l "${backupPath}" | head -50`,
        );
        this.logger.log(`Dry run output (first 50 lines):\n${stdout}`);
        return { rowsAffected: 0 };
      }

      this.logger.log(`Starting restore from ${backupPath}`);
      const { stdout } = await execAsync(
        `pg_restore -h "${dbConfig.host}" -p ${dbConfig.port} -U "${dbConfig.username}" -d "${dbConfig.name}" "${backupPath}"`,
        { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 * 1024 },
      );

      this.logger.log(`Restore completed successfully`);
      return { rowsAffected: 0 };
    } catch (error) {
      this.logger.error('Restore failed', error);
      throw new Error(`Restore failed: ${(error as Error).message}`);
    }
  }

  async cleanupOldBackups(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('backup-'));

      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          this.logger.log(`Deleted old backup: ${file}`);
          deleted++;
        }
      }

      return deleted;
    } catch (error) {
      this.logger.error('Backup cleanup failed', error);
      return 0;
    }
  }

  async listBackups(): Promise<BackupResult[]> {
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('backup-'));

      const backups: BackupResult[] = [];

      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        const checksum = await this.calculateChecksum(filePath);

        backups.push({
          path: filePath,
          sizeBytes: stats.size,
          createdAt: stats.mtime,
          checksum,
        });
      }

      return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      this.logger.error('Failed to list backups', error);
      return [];
    }
  }

  async verifyBackup(backupPath: string): Promise<boolean> {
    try {
      const checksum = await this.calculateChecksum(backupPath);
      const backups = await this.listBackups();

      const backup = backups.find((b) => b.path === backupPath);
      if (!backup) {
        return false;
      }

      return backup.checksum === checksum;
    } catch (error) {
      this.logger.error('Backup verification failed', error);
      return false;
    }
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const { stdout } = await execAsync(
      `sha256sum "${filePath}" | awk '{print $1}'`,
    );
    return stdout.trim();
  }

  private ensureBackupDirExists(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }
}
