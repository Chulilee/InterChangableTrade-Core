import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { Wallet, WalletStatus } from './entities/wallet.entity';
import { StellarService } from '../stellar/stellar.service';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_WALLET_ID = 'wallet-uuid-5678';

const mockWallet: Partial<Wallet> = {
  id: MOCK_WALLET_ID,
  userId: MOCK_USER_ID,
  publicKey: 'GDUMMYPUBLICKEY123456789012345678901234567890123456',
  label: 'Test Wallet',
  status: WalletStatus.ACTIVE,
  isPrimary: true,
  cachedBalance: '100.0000000',
};

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    create: jest.fn().mockReturnValue(mockWallet),
    save: jest.fn().mockResolvedValue(mockWallet),
    update: jest.fn().mockResolvedValue(undefined),
  },
};

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
};

const mockWalletRepository = {
  count: jest.fn().mockResolvedValue(0),
  findOne: jest.fn().mockResolvedValue(mockWallet),
  findAndCount: jest.fn().mockResolvedValue([[mockWallet], 1]),
  save: jest.fn().mockResolvedValue(mockWallet),
  create: jest.fn().mockReturnValue(mockWallet),
};

const mockStellarService = {
  getAccount: jest.fn().mockResolvedValue({
    accountId: mockWallet.publicKey,
    sequence: '100',
    balances: [{ assetType: 'native', balance: '500.0000000' }],
  }),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      WALLET_ENCRYPTION_KEY: 'test-encryption-key-that-is-32chars!!',
      'stellar.networkPassphrase': 'Test SDF Network ; September 2015',
    };
    return config[key];
  }),
};

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Wallet), useValue: mockWalletRepository },
        { provide: StellarService, useValue: mockStellarService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a wallet and return it', async () => {
      const result = await service.create(MOCK_USER_ID, { label: 'Test Wallet' });
      expect(result).toBeDefined();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('findAllForUser', () => {
    it('should return paginated wallets', async () => {
      const result = await service.findAllForUser(MOCK_USER_ID, {
        page: 1,
        limit: 10,
        skip: 0,
      });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return the wallet if user owns it', async () => {
      const wallet = await service.findOne(MOCK_WALLET_ID, MOCK_USER_ID);
      expect(wallet.id).toBe(MOCK_WALLET_ID);
    });

    it('should throw NotFoundException if wallet does not exist', async () => {
      mockWalletRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('non-existent', MOCK_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own the wallet', async () => {
      await expect(service.findOne(MOCK_WALLET_ID, 'other-user')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('syncBalance', () => {
    it('should update cachedBalance from Stellar network', async () => {
      const wallet = await service.syncBalance(MOCK_WALLET_ID, MOCK_USER_ID);
      expect(mockStellarService.getAccount).toHaveBeenCalledWith(mockWallet.publicKey);
      expect(mockWalletRepository.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException when removing primary wallet', async () => {
      await expect(service.remove(MOCK_WALLET_ID, MOCK_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should deactivate a non-primary wallet', async () => {
      mockWalletRepository.findOne.mockResolvedValueOnce({
        ...mockWallet,
        isPrimary: false,
      });
      await service.remove(MOCK_WALLET_ID, MOCK_USER_ID);
      expect(mockWalletRepository.save).toHaveBeenCalled();
    });
  });

  describe('configureMultisig', () => {
    it('should set multisig threshold and cosigners', async () => {
      const dto = { threshold: 2, cosigners: ['GCOSIGNER1', 'GCOSIGNER2'] };
      await service.configureMultisig(MOCK_WALLET_ID, MOCK_USER_ID, dto);
      expect(mockWalletRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if wallet key is in cosigners list', async () => {
      const dto = {
        threshold: 1,
        cosigners: [mockWallet.publicKey as string],
      };
      await expect(
        service.configureMultisig(MOCK_WALLET_ID, MOCK_USER_ID, dto),
      ).rejects.toThrow();
    });
  });
});