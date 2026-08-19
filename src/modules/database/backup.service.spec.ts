import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  let service: BackupService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(BackupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startAutomatedBackup', () => {
    it('should start automated backups when enabled', () => {
      mockConfigService.get
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(30)
        .mockReturnValueOnce(7);

      jest.useFakeTimers();
      service.startAutomatedBackup();

      expect(service['intervalHandle']).not.toBeNull();

      service.stopAutomatedBackup();
      jest.useRealTimers();
    });

    it('should not start when disabled', () => {
      mockConfigService.get.mockReturnValue(false);

      service.startAutomatedBackup();

      expect(service['intervalHandle']).toBeNull();
    });
  });

  describe('cleanupOldBackups', () => {
    it('should remove backups older than retention period', async () => {
      const fs = require('fs');
      const path = require('path');
      const backupDir = '/tmp/backups';

      const oldBackup = {
        name: 'backup-old.sql',
        mtime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      };
      const newBackup = {
        name: 'backup-new.sql',
        mtime: new Date(),
      };

      const originalReaddirSync = fs.readdirSync;
      const originalStatSync = fs.statSync;
      const originalUnlinkSync = fs.unlinkSync;

      fs.readdirSync = jest.fn().mockReturnValue([oldBackup.name, newBackup.name]);
      fs.statSync = jest.fn().mockImplementation((p: string) => {
        const name = path.basename(p);
        if (name === oldBackup.name) return oldBackup;
        return newBackup;
      });
      fs.unlinkSync = jest.fn();

      const deleted = await service.cleanupOldBackups();

      expect(deleted).toBe(1);

      fs.readdirSync = originalReaddirSync;
      fs.statSync = originalStatSync;
      fs.unlinkSync = originalUnlinkSync;
    });
  });
});
