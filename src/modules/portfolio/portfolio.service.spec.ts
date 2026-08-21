import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioService } from './portfolio.service';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { PerformanceTimeFrame } from './dto/portfolio-query.dto';
import { Wallet } from '../wallet/entities/wallet.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Trade } from '../trading-engine/entities/trade.entity';
import { Asset, AssetStatus } from '../assets/entities/asset.entity';
import { TrustLine } from '../assets/entities/trustline.entity';

const MOCK_USER_ID = 'user-uuid-1234';

const mockWallet: Partial<Wallet> = {
  id: 'wallet-1',
  userId: MOCK_USER_ID,
  publicKey: 'GDUMMYPUBLICKEY123456789012345678901234567890123456',
  cachedBalance: '500.0000000',
  balanceSyncedAt: new Date(),
  isPrimary: true,
};

const mockAsset: Partial<Asset> = {
  id: 'asset-1',
  code: 'USDC',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  isNative: false,
  totalSupply: '1000000',
  status: AssetStatus.ACTIVE,
};

const mockXlmAsset: Partial<Asset> = {
  id: 'asset-xlm',
  code: 'XLM',
  issuer: null,
  isNative: true,
  totalSupply: '50000000000',
  status: AssetStatus.ACTIVE,
};

const mockTrustline: Partial<TrustLine> = {
  id: 'tl-1',
  balance: '100.0000000',
  limit: '1000.0000000',
  asset: mockAsset as Asset,
  user: { id: MOCK_USER_ID } as any,
};

const mockSnapshot: Partial<PortfolioSnapshot> = {
  id: 'snap-1',
  userId: MOCK_USER_ID,
  snapshotDate: new Date(),
  totalValueUsd: '60.0000000',
  assetCount: 2,
  holdings: { XLM: '500', USDC: '100' },
};

function createMockRepo() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    query: jest.fn(),
  };
}

describe('PortfolioService', () => {
  let service: PortfolioService;
  let snapshotRepo: jest.Mocked<Repository<PortfolioSnapshot>>;
  let walletRepo: jest.Mocked<Repository<Wallet>>;
  let assetRepo: jest.Mocked<Repository<Asset>>;
  let trustlineRepo: jest.Mocked<Repository<TrustLine>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(PortfolioSnapshot),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(Wallet),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(Asset),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(TrustLine),
          useValue: createMockRepo(),
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
    snapshotRepo = module.get(getRepositoryToken(PortfolioSnapshot));
    walletRepo = module.get(getRepositoryToken(Wallet));
    assetRepo = module.get(getRepositoryToken(Asset));
    trustlineRepo = module.get(getRepositoryToken(TrustLine));

    // Default mock behaviors
    walletRepo.find.mockResolvedValue([mockWallet] as Wallet[]);
    trustlineRepo.find.mockResolvedValue([mockTrustline] as TrustLine[]);
    snapshotRepo.findOne.mockResolvedValue(null);
    snapshotRepo.find.mockResolvedValue([]);
    snapshotRepo.save.mockImplementation(
      async (entity) =>
        ({
          ...entity,
          id: 'snap-new',
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as PortfolioSnapshot,
    );
    snapshotRepo.create.mockImplementation(
      (entity) => entity as PortfolioSnapshot,
    );

    // Asset price lookups
    assetRepo.findOne.mockImplementation(async (options: any) => {
      const where = options?.where;
      if (where?.code === 'XLM' || where?.isNative)
        return mockXlmAsset as Asset;
      return mockAsset as Asset;
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('getDashboard', () => {
    it('should return a complete portfolio dashboard', async () => {
      const result = await service.getDashboard(
        MOCK_USER_ID,
        PerformanceTimeFrame.ALL_TIME,
      );

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.holdings).toBeDefined();
      expect(result.performance).toBeDefined();
      expect(result.allocation).toBeDefined();
    });

    it('should calculate total value from wallet and trustline balances', async () => {
      const result = await service.getDashboard(MOCK_USER_ID);

      // XLM: 500 * 0.12 = 60, USDC: 100 * 0 = 0 (no price for non-native)
      expect(result.summary.totalValueUsd).toBe(60);
      expect(result.summary.totalAssets).toBe(2);
      expect(result.summary.totalWallets).toBe(1);
    });

    it('should include XLM and USDC holdings', async () => {
      const result = await service.getDashboard(MOCK_USER_ID);

      const codes = result.holdings.map((h) => h.assetCode);
      expect(codes).toContain('XLM');
      expect(codes).toContain('USDC');
    });

    it('should calculate allocation percentages', async () => {
      const result = await service.getDashboard(MOCK_USER_ID);

      expect(result.allocation.byAsset).toHaveLength(2);
      expect(result.allocation.byAsset.every((a) => a.percent >= 0)).toBe(true);
    });

    it('should group allocation by type', async () => {
      const result = await service.getDashboard(MOCK_USER_ID);

      expect(result.allocation.byType).toHaveLength(2);
      const types = result.allocation.byType.map((t) => t.type);
      expect(types).toContain('Native (XLM)');
      expect(types).toContain('Tokenized Assets');
    });

    it('should calculate performance for requested timeframe', async () => {
      const result = await service.getDashboard(
        MOCK_USER_ID,
        PerformanceTimeFrame.ONE_MONTH,
      );

      expect(result.performance).toBeDefined();
      expect(result.performance.length).toBeGreaterThanOrEqual(1);
    });

    it('should return all 4 timeframes for ALL_TIME', async () => {
      const result = await service.getDashboard(
        MOCK_USER_ID,
        PerformanceTimeFrame.ALL_TIME,
      );

      expect(result.performance).toHaveLength(4);
      const frames = result.performance.map((p) => p.timeframe);
      expect(frames).toEqual(['1D', '1M', '1Y', 'ALL']);
    });

    it('should handle empty portfolio', async () => {
      walletRepo.find.mockResolvedValue([]);
      trustlineRepo.find.mockResolvedValue([]);

      const result = await service.getDashboard(MOCK_USER_ID);

      expect(result.summary.totalValueUsd).toBe(0);
      expect(result.summary.totalAssets).toBe(0);
      expect(result.holdings).toHaveLength(0);
    });

    it('should merge duplicate XLM entries from multiple wallets', async () => {
      walletRepo.find.mockResolvedValue([
        { ...mockWallet, id: 'w1', cachedBalance: '300.0000000' },
        {
          ...mockWallet,
          id: 'w2',
          cachedBalance: '200.0000000',
          isPrimary: false,
        },
      ] as Wallet[]);

      const result = await service.getDashboard(MOCK_USER_ID);

      const xlm = result.holdings.find((h) => h.assetCode === 'XLM');
      expect(xlm).toBeDefined();
      expect(xlm!.balance).toBe('500');
      // 500 XLM * 0.12 = 60
      expect(xlm!.valueUsd).toBe(60);
    });

    it('should use previous snapshot for daily change', async () => {
      snapshotRepo.findOne.mockResolvedValue({
        ...mockSnapshot,
        totalValueUsd: '50.0000000',
      } as PortfolioSnapshot);

      const result = await service.getDashboard(MOCK_USER_ID);

      expect(result.summary.dailyChangeUsd).toBe(10);
      expect(result.summary.dailyChangePercent).toBeCloseTo(20, 0);
    });
  });

  describe('createSnapshot', () => {
    it('should create and save a portfolio snapshot', async () => {
      const result = await service.createSnapshot(MOCK_USER_ID);

      expect(result).toBeDefined();
      expect(result.userId).toBe(MOCK_USER_ID);
      expect(snapshotRepo.save).toHaveBeenCalled();
    });

    it('should include holdings data in snapshot', async () => {
      const result = await service.createSnapshot(MOCK_USER_ID);

      expect(result.holdings).toBeDefined();
      expect(typeof result.holdings).toBe('object');
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots within timeframe', async () => {
      snapshotRepo.find.mockResolvedValue([mockSnapshot as PortfolioSnapshot]);

      const result = await service.getSnapshots(
        MOCK_USER_ID,
        PerformanceTimeFrame.ONE_MONTH,
      );

      expect(result).toHaveLength(1);
      expect(snapshotRepo.find).toHaveBeenCalled();
    });

    it('should return empty array when no snapshots exist', async () => {
      snapshotRepo.find.mockResolvedValue([]);

      const result = await service.getSnapshots(
        MOCK_USER_ID,
        PerformanceTimeFrame.ONE_DAY,
      );

      expect(result).toHaveLength(0);
    });
  });
});
