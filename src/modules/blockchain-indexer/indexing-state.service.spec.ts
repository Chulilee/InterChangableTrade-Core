import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { IndexingStateService } from './services/indexing-state.service';

describe('BlockchainIndexer Service Tests', () => {
  let module: TestingModule;
  let indexingStateService: IndexingStateService;

  const mockStateRepo = {
    findOne: jest.fn(),
    upsert: jest.fn(),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        IndexingStateService,
        {
          provide: 'IndexerStateRepository',
          useValue: mockStateRepo,
        },
      ],
    }).compile();

    await module.init();
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    indexingStateService = module.get(IndexingStateService);
    jest.clearAllMocks();
  });

  describe('IndexingStateService', () => {
    it('should persist and retrieve state', async () => {
      mockStateRepo.findOne.mockResolvedValue({
        key: 'test_key',
        value: 'test_value',
      });
      const value = await indexingStateService.get('test_key');
      expect(value).toBe('test_value');
    });

    it('should track last indexed ledger', async () => {
      mockStateRepo.findOne.mockResolvedValue({
        key: 'last_indexed_ledger',
        value: '12345',
      });
      const ledger = await indexingStateService.getLastIndexedLedger();
      expect(ledger).toBe(12345);
    });

    it('should return null when state is missing', async () => {
      mockStateRepo.findOne.mockResolvedValue(null);
      const value = await indexingStateService.get('missing');
      expect(value).toBeNull();
    });

    it('should persist new state via upsert', async () => {
      mockStateRepo.upsert.mockResolvedValue(undefined);
      await indexingStateService.set('k1', 'v1');
      expect(mockStateRepo.upsert).toHaveBeenCalledWith(
        { key: 'k1', value: 'v1', updatedAt: expect.any(Date) },
        ['key'],
      );
    });

    it('should update last indexed ledger', async () => {
      mockStateRepo.upsert.mockResolvedValue(undefined);
      await indexingStateService.setLastIndexedLedger(15000);
      expect(mockStateRepo.upsert).toHaveBeenCalledWith(
        {
          key: 'last_indexed_ledger',
          value: '15000',
          updatedAt: expect.any(Date),
        },
        ['key'],
      );
    });

    it('should persist cursor state', async () => {
      mockStateRepo.upsert.mockResolvedValue(undefined);
      await indexingStateService.setLastCursor('cursor_123');
      expect(mockStateRepo.upsert).toHaveBeenCalledWith(
        {
          key: 'last_cursor',
          value: 'cursor_123',
          updatedAt: expect.any(Date),
        },
        ['key'],
      );
    });
  });
});
