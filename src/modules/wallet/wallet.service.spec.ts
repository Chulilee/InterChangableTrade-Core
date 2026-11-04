import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { WalletService } from './wallet.service';
import { Wallet, WalletStatus } from './entities/wallet.entity';
import { StellarService } from '../stellar/stellar.service';
import { StepUpTokenService } from '../auth/step-up-token.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../users/entities/user.entity';

const MOCK_USER_ID = 'user-uuid-1234';
const MOCK_WALLET_ID = 'wallet-uuid-5678';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const ENCRYPTION_KEY = 'test-encryption-key-that-is-32chars!!';

const WALLET_KEYPAIR = Keypair.random();
const OTHER_KEYPAIR = Keypair.random();
const DESTINATION_KEYPAIR = Keypair.random();

function encryptSecret(secret: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'wallet-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function buildUnsignedXdr(
  operations: xdr.Operation[],
  source: string = WALLET_KEYPAIR.publicKey(),
): string {
  let builder = new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  for (const operation of operations) {
    builder = builder.addOperation(operation);
  }
  return builder.setTimeout(30).build().toEnvelope().toXDR('base64');
}

function paymentOperation() {
  return Operation.payment({
    destination: DESTINATION_KEYPAIR.publicKey(),
    asset: Asset.native(),
    amount: '1.0000000',
  });
}

const mockWallet: Partial<Wallet> = {
  id: MOCK_WALLET_ID,
  userId: MOCK_USER_ID,
  publicKey: WALLET_KEYPAIR.publicKey(),
  encryptedSecretKey: encryptSecret(WALLET_KEYPAIR.secret()),
  label: 'Test Wallet',
  status: WalletStatus.ACTIVE,
  isPrimary: true,
  cachedBalance: '100.0000000',
};

let signingAllowedOperations: string[] = ['payment'];
let networkPassphrase: string | undefined = NETWORK_PASSPHRASE;

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
    if (key === 'wallet.signing.allowedOperations') {
      return signingAllowedOperations;
    }
    if (key === 'stellar.networkPassphrase') {
      return networkPassphrase;
    }
    const config: Record<string, unknown> = {
      WALLET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    };
    return config[key];
  }),
};

const mockStepUpTokenService = {
  verify: jest.fn((token: string | undefined) => {
    if (!token) {
      throw new UnauthorizedException('Step-up authentication required');
    }
  }),
};

const mockAuditService = {
  record: jest.fn(),
};

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    signingAllowedOperations = ['payment'];
    networkPassphrase = NETWORK_PASSPHRASE;
    mockWalletRepository.findOne.mockResolvedValue(mockWallet);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(Wallet), useValue: mockWalletRepository },
        { provide: StellarService, useValue: mockStellarService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: StepUpTokenService, useValue: mockStepUpTokenService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should create a wallet and return it', async () => {
      const result = await service.create(MOCK_USER_ID, {
        label: 'Test Wallet',
      });
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
      await expect(
        service.findOne('non-existent', MOCK_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user does not own the wallet', async () => {
      await expect(
        service.findOne(MOCK_WALLET_ID, 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('syncBalance', () => {
    it('should update cachedBalance from Stellar network', async () => {
      await service.syncBalance(MOCK_WALLET_ID, MOCK_USER_ID);
      expect(mockStellarService.getAccount).toHaveBeenCalledWith(
        mockWallet.publicKey,
      );
      expect(mockWalletRepository.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException when removing primary wallet', async () => {
      await expect(
        service.remove(MOCK_WALLET_ID, MOCK_USER_ID),
      ).rejects.toThrow(BadRequestException);
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

  describe('signTransaction', () => {
    it('signs an allowed payment and writes an audit record with hash and operations', async () => {
      const unsignedXdr = buildUnsignedXdr([paymentOperation()]);

      const result = await service.signTransaction(
        MOCK_WALLET_ID,
        MOCK_USER_ID,
        {
          unsignedXdr,
        },
      );

      expect(result.signedXdr).toEqual(expect.any(String));
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wallet.sign_transaction',
          userId: MOCK_USER_ID,
          resourceId: MOCK_WALLET_ID,
          metadata: expect.objectContaining({
            transactionHash: expect.any(String),
            operationTypes: ['payment'],
          }),
        }),
      );
    });

    it('rejects an envelope whose source is not the wallet public key', async () => {
      const unsignedXdr = buildUnsignedXdr(
        [paymentOperation()],
        OTHER_KEYPAIR.publicKey(),
      );

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('rejects operations outside the allowlist with the allowed set', async () => {
      signingAllowedOperations = ['payment'];
      const unsignedXdr = buildUnsignedXdr([
        Operation.setOptions({ homeDomain: 'example.com' }),
      ]);

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow(/not allowed by the wallet signing policy.*payment/);
    });

    it('rejects setOptions for a non-admin even when allowlisted', async () => {
      signingAllowedOperations = ['payment', 'setOptions'];
      const unsignedXdr = buildUnsignedXdr([
        Operation.setOptions({ homeDomain: 'example.com' }),
      ]);

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, {
          unsignedXdr,
          role: undefined,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, {
          unsignedXdr,
          role: UserRole.USER,
          stepUpToken: 'step-up',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an admin high-risk operation without a step-up token', async () => {
      signingAllowedOperations = ['payment', 'accountMerge'];
      const unsignedXdr = buildUnsignedXdr([
        Operation.accountMerge({
          destination: DESTINATION_KEYPAIR.publicKey(),
        }),
      ]);

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, {
          unsignedXdr,
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows an admin high-risk operation with a step-up token', async () => {
      signingAllowedOperations = ['payment', 'accountMerge'];
      const unsignedXdr = buildUnsignedXdr([
        Operation.accountMerge({
          destination: DESTINATION_KEYPAIR.publicKey(),
        }),
      ]);

      await service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, {
        unsignedXdr,
        role: UserRole.ADMIN,
        stepUpToken: 'valid-step-up-token',
      });

      expect(mockStepUpTokenService.verify).toHaveBeenCalledWith(
        'valid-step-up-token',
        MOCK_USER_ID,
      );
    });

    it('fails closed when the network passphrase is missing', async () => {
      networkPassphrase = undefined;
      const unsignedXdr = buildUnsignedXdr([paymentOperation()]);

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects an oversized unsigned XDR before parsing it', async () => {
      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, {
          unsignedXdr: 'a'.repeat(4097),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('binds decorated signatures to the wallet source and audits them', async () => {
      const unsignedXdr = buildUnsignedXdr([paymentOperation()]);

      await service.createDecoratedSignature(
        MOCK_WALLET_ID,
        MOCK_USER_ID,
        unsignedXdr,
      );

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'wallet.create_decorated_signature',
          metadata: expect.objectContaining({
            transactionHash: expect.any(String),
            operationTypes: ['payment'],
          }),
        }),
      );

      await expect(
        service.createDecoratedSignature(
          MOCK_WALLET_ID,
          MOCK_USER_ID,
          buildUnsignedXdr([paymentOperation()], OTHER_KEYPAIR.publicKey()),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
