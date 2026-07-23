import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ShardManagerService, ShardStrategy } from './shard-manager.service';

describe('ShardManagerService', () => {
  let service: ShardManagerService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShardManagerService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(ShardManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getShard', () => {
    it('should return 0 when sharding is disabled', () => {
      mockConfigService.get
        .mockReturnValueOnce('hash')
        .mockReturnValueOnce(1);

      const result = service.getShard('test_key');

      expect(result).toBe(0);
    });

    it('should return shard ID based on hash', () => {
      mockConfigService.get
        .mockReturnValueOnce('hash')
        .mockReturnValueOnce(4);

      const result = service.getShard('test_key');

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(4);
    });

    it('should return consistent shard for same key', () => {
      mockConfigService.get
        .mockReturnValueOnce('hash')
        .mockReturnValueOnce(4);

      const result1 = service.getShard('same_key');
      const result2 = service.getShard('same_key');

      expect(result1).toBe(result2);
    });
  });

  describe('getShardConnection', () => {
    it('should return connection details for shard', () => {
      mockConfigService.get
        .mockReturnValueOnce('hash')
        .mockReturnValueOnce(2);

      const connection = service.getShardConnection(0);

      expect(connection.host).toBeDefined();
      expect(connection.port).toBeDefined();
      expect(connection.database).toBeDefined();
    });

    it('should throw for unknown shard', () => {
      mockConfigService.get
        .mockReturnValueOnce('hash')
        .mockReturnValueOnce(1);

      expect(() => service.getShardConnection(99)).toThrow('Shard 99 not found');
    });
  });

  describe('registerShardKey', () => {
    it('should register shard key', () => {
      service.registerShardKey('users', 'id', 'hash');

      const key = service.getShardKey('users', 'id');

      expect(key).toBeDefined();
      expect(key?.strategy).toBe('hash');
    });
  });

  describe('getConfig', () => {
    it('should return shard configuration', () => {
      mockConfigService.get
        .mockReturnValueOnce('range')
        .mockReturnValueOnce(3);

      const config = service.getConfig();

      expect(config.strategy).toBe('range');
      expect(config.shardCount).toBe(3);
      expect(config.shards.length).toBe(3);
    });
  });
});
