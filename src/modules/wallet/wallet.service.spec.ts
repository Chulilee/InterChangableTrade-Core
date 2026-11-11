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

// Fixed, clearly test-only Stellar vectors (not real/production secrets).
const TEST_SECRET = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET_KEYPAIR = Keypair.fromSecret(TEST_SECRET);
const OTHER_KEYPAIR = Keypair.fromSecret(
  'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
);
const DESTINATION_KEYPAIR = Keypair.fromSecret(
  'SCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
);

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

function makeWallet(overrides: Partial<Wallet> = {}): Partial<Wallet> {
  return {
    id: MOCK_WALLET_ID,
    userId: MOCK_USER_ID,
    publicKey: WALLET_KEYPAIR.publicKey(),
    encryptedSecretKey: encryptSecret(WALLET_KEYPAIR.secret()),
    label: 'Test Wallet',
    status: WalletStatus.ACTIVE,
    isPrimary: true,
    cachedBalance: '100.0000000',
    ...overrides,
  };
}

let signingAllowedOperations: string[] = ['payment'];
let networkPassphrase: string | undefined = NETWORK_PASSPHRASE;

const mockQueryRunner = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  },
};

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
};

const mockWalletRepository = {
  count: jest.fn().mockResolvedValue(0),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};

const mockStellarService = {
  getAccount: jest.fn().mockResolvedValue({
    accountId: WALLET_KEYPAIR.publicKey(),
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
    jest.clearAllMocks();
    signingAllowedOperations = ['payment'];
    networkPassphrase = NETWORK_PASSPHRASE;

    const currentWallet = makeWallet();
    mockWalletRepository.findOne.mockResolvedValue(currentWallet);
    mockWalletRepository.findAndCount.mockResolvedValue([[currentWallet], 1]);
    mockWalletRepository.save.mockImplementation(async (v) => v);
    mockWalletRepository.count.mockResolvedValue(0);
    mockWalletRepository.create.mockReturnValue(currentWallet);

    mockQueryRunner.manager.create.mockImplementation((_entity, data) => ({
      id: MOCK_WALLET_ID,
      ...data,
    }));
    mockQueryRunner.manager.save.mockImplementation(async (entity) => ({
      ...entity,
    }));

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

  describe('encrypt/decrypt', () => {
    it('round-trips a valid Stellar secret (fixed test-only vector)', () => {
      const encrypt = (service as any).encrypt.bind(service) as (v: string) => string;
      const decrypt = (service as any).decrypt.bind(service) as (v: string) => string;

      const ciphertext = encrypt(TEST_SECRET);
      expect(decrypt(ciphertext)).toBe(TEST_SECRET);
      expect(ciphertext.split(':')).toHaveLength(3);
    });

    it('produces different ciphertexts for the same plaintext (unique IV)', () => {
      const encrypt = (service as any).encrypt.bind(service) as (v: string) => string;

      const first = encrypt(TEST_SECRET);
      const second = encrypt(TEST_SECRET);

      expect(first).not.toEqual(second);
      expect(first.split(':')[0]).not.toEqual(second.split(':')[0]);
    });

    it('throws a typed 4xx-mappable error when ciphertext is tampered', () => {
      const encrypt = (service as any).encrypt.bind(service) as (v: string) => string;
      const decrypt = (service as any).decrypt.bind(service) as (v: string) => string;
      const ciphertext = encrypt(TEST_SECRET);
      const [iv, tag, body] = ciphertext.split(':');
      const flipped = body.slice(0, -2) + (body.slice(-2) === '00' ? '01' : '00');

      expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow(BadRequestException);
      try {
        decrypt(`${iv}:${tag}:${flipped}`);
      } catch (error) {
        expect(error).not.toBeInstanceOf(InternalServerErrorException);
        expect((error as Error).message).not.toContain('Unsupported state');
      }
    });

    it('rejects a malformed-format string cleanly', () => {
      const decrypt = (service as any).decrypt.bind(service) as (v: string) => string;

      expect(() => decrypt('not-a-valid-ciphertext')).toThrow(BadRequestException);
      expect(() => decrypt('part1:part2')).toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    it('creates a wallet and never includes encryptedSecretKey in the response', async () => {
      mockQueryRunner.manager.create.mockImplementation((_entity, data) => ({
        id: MOCK_WALLET_ID,
        encryptedSecretKey: 'ciphertext:present:here',
        ...data,
      }));
      mockQueryRunner.manager.save.mockImplementation(async (entity) => ({
        ...entity,
      }));

      const result = await service.create(MOCK_USER_ID, { label: 'Test Wallet' });

      expect(result).toBeDefined();
      expect((result as any).encryptedSecretKey).toBeUndefined();
      expect(result).not.toHaveProperty('encryptedSecretKey');
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

  describe('update', () => {
    it('updates wallet fields and never includes encryptedSecretKey in the response', async () => {
      const existing = makeWallet({ isPrimary: false });
      mockWalletRepository.findOne.mockResolvedValue(existing);
      mockQueryRunner.manager.save.mockImplementation(async (entity) => ({
        ...entity,
        encryptedSecretKey: 'ciphertext:present:here',
      }));

      const result = await service.update(MOCK_WALLET_ID, MOCK_USER_ID, {
        label: 'Renamed',
      } as any);

      expect((result as any).encryptedSecretKey).toBeUndefined();
      expect(result).not.toHaveProperty('encryptedSecretKey');
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('syncBalance', () => {
    it('should update cachedBalance from Stellar network', async () => {
      await service.syncBalance(MOCK_WALLET_ID, MOCK_USER_ID);
      expect(mockStellarService.getAccount).toHaveBeenCalledWith(
        makeWallet().publicKey,
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
      mockWalletRepository.findOne.mockResolvedValueOnce(
        makeWallet({ isPrimary: false }),
      );
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
        cosigners: [WALLET_KEYPAIR.publicKey()],
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

    it('verifies the transaction source account against the wallet public key', async () => {
      const unsignedXdr = buildUnsignedXdr(
        [paymentOperation()],
        OTHER_KEYPAIR.publicKey(),
      );

      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow('Transaction source account does not match the wallet');
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
        service.signTransaction(MOCK_WALLET_ID, MOCK_USER_ID, { unsignedXdr }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.signTransaction(
          MOCK_WALLET_ID,
          MOCK_USER_ID,
          { unsignedXdr },
          { role: UserRole.USER, stepUpToken: 'step-up' },
        ),
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
        service.signTransaction(
          MOCK_WALLET_ID,
          MOCK_USER_ID,
          { unsignedXdr },
          { role: UserRole.ADMIN },
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows an admin high-risk operation with a step-up token', async () => {
      signingAllowedOperations = ['payment', 'accountMerge'];
      const unsignedXdr = buildUnsignedXdr([
        Operation.accountMerge({
          destination: DESTINATION_KEYPAIR.publicKey(),
        }),
      ]);

      await service.signTransaction(
        MOCK_WALLET_ID,
        MOCK_USER_ID,
        { unsignedXdr },
        { role: UserRole.ADMIN, stepUpToken: 'valid-step-up-token' },
      );

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
