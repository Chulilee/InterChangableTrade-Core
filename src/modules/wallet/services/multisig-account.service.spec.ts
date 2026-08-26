import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { MultisigAccountService } from './multisig-account.service';
import { WalletService } from '../wallet.service';
import { StellarService } from '../../stellar/stellar.service';
import { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { EnableMultisigDto } from '../dto/enable-multisig.dto';
import { RotateKeyDto } from '../dto/rotate-key.dto';

const PASSPHRASE = Networks.TESTNET;
const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user',
};
const WALLET_ID = 'wallet-1';

// The wallet's own account key (the master key of the multisig).
const accountKp = Keypair.random();

/** Decodes an unsigned envelope's operations for assertion. */
function decodeOps(unsignedXdr: string): any[] {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, PASSPHRASE) as any;
  return tx.operations;
}

describe('MultisigAccountService', () => {
  let service: MultisigAccountService;
  let walletService: any;
  let stellarService: any;

  const wallet = {
    id: WALLET_ID,
    userId: USER.id,
    publicKey: accountKp.publicKey(),
    status: 'active',
  };

  // A brand-new account: only the master key signs, all thresholds at 0.
  const freshAccountConfig = () => ({
    accountId: accountKp.publicKey(),
    masterWeight: 1,
    thresholds: { low: 0, med: 0, high: 0 },
    signers: [
      { key: accountKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
    ],
  });

  beforeEach(async () => {
    walletService = { findOne: jest.fn().mockResolvedValue(wallet) };
    stellarService = {
      getAccount: jest.fn().mockResolvedValue({
        accountId: accountKp.publicKey(),
        sequence: '100',
        balances: [],
      }),
      getAccountSigners: jest.fn().mockResolvedValue(freshAccountConfig()),
      getNetworkInfo: jest.fn().mockReturnValue({
        network: 'testnet',
        passphrase: PASSPHRASE,
        horizonUrl: 'https://horizon-testnet.stellar.org',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultisigAccountService,
        { provide: WalletService, useValue: walletService },
        { provide: StellarService, useValue: stellarService },
      ],
    }).compile();

    service = module.get<MultisigAccountService>(MultisigAccountService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOnChainConfig', () => {
    it('verifies ownership then returns the live signer summary', async () => {
      const summary = await service.getOnChainConfig(WALLET_ID, USER);

      expect(walletService.findOne).toHaveBeenCalledWith(WALLET_ID, USER.id);
      expect(stellarService.getAccountSigners).toHaveBeenCalledWith(
        accountKp.publicKey(),
      );
      expect(summary.accountId).toBe(accountKp.publicKey());
    });
  });

  describe('buildEnableMultisigTx', () => {
    const signerA = Keypair.random().publicKey();
    const signerB = Keypair.random().publicKey();

    it('builds a SetOptions tx with a threshold op plus one op per signer', async () => {
      const dto: EnableMultisigDto = {
        signers: [
          { publicKey: signerA, weight: 1 },
          { publicKey: signerB, weight: 1 },
        ],
        medThreshold: 2,
        highThreshold: 2,
      };

      const { unsignedXdr, summary } = await service.buildEnableMultisigTx(
        WALLET_ID,
        USER,
        dto,
      );

      const ops = decodeOps(unsignedXdr);
      expect(ops).toHaveLength(3);
      expect(ops.every((o) => o.type === 'setOptions')).toBe(true);
      // First op carries the threshold changes; the rest add the signers.
      expect(ops[0].medThreshold).toBe(2);
      expect(ops[0].highThreshold).toBe(2);
      expect(ops.slice(1).map((o) => o.signer.ed25519PublicKey)).toEqual(
        expect.arrayContaining([signerA, signerB]),
      );
      expect(summary).toContain('2 signer(s)');
    });

    it('rejects a resulting signer set larger than the 20-signer limit', async () => {
      const dto: EnableMultisigDto = {
        signers: Array.from({ length: 21 }, () => ({
          publicKey: Keypair.random().publicKey(),
          weight: 1,
        })),
      };

      await expect(
        service.buildEnableMultisigTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects adding the account key as a signer of itself', async () => {
      const dto: EnableMultisigDto = {
        signers: [{ publicKey: accountKp.publicKey(), weight: 1 }],
      };

      await expect(
        service.buildEnableMultisigTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a threshold that exceeds the total achievable weight', async () => {
      const dto: EnableMultisigDto = {
        signers: [
          { publicKey: signerA, weight: 1 },
          { publicKey: signerB, weight: 1 },
        ],
        highThreshold: 10, // total weight is only master(1) + 1 + 1 = 3
      };

      await expect(
        service.buildEnableMultisigTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('buildRotateKeyTx', () => {
    const oldKp = Keypair.random();
    const newKp = Keypair.random();
    const existingKp = Keypair.random();

    // Master key plus two additional signers.
    const configWithTwoSigners = () => ({
      accountId: accountKp.publicKey(),
      masterWeight: 1,
      thresholds: { low: 0, med: 0, high: 0 },
      signers: [
        { key: accountKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
        { key: oldKp.publicKey(), weight: 3, type: 'ed25519_public_key' },
        { key: existingKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
      ],
    });

    it('adds the new signer and removes the old one in a single tx', async () => {
      stellarService.getAccountSigners.mockResolvedValue(
        configWithTwoSigners(),
      );
      const dto: RotateKeyDto = {
        oldSignerPublicKey: oldKp.publicKey(),
        newSignerPublicKey: newKp.publicKey(),
      };

      const { unsignedXdr } = await service.buildRotateKeyTx(
        WALLET_ID,
        USER,
        dto,
      );

      const ops = decodeOps(unsignedXdr);
      expect(ops).toHaveLength(2);
      // New signer added first, defaulting to the outgoing signer's weight.
      expect(ops[0].signer.ed25519PublicKey).toBe(newKp.publicKey());
      expect(ops[0].signer.weight).toBe(3);
      // Old signer removed via weight 0.
      expect(ops[1].signer.ed25519PublicKey).toBe(oldKp.publicKey());
      expect(ops[1].signer.weight).toBe(0);
    });

    it('rejects rotating a signer that is not on the account', async () => {
      const dto: RotateKeyDto = {
        oldSignerPublicKey: oldKp.publicKey(),
        newSignerPublicKey: newKp.publicKey(),
      };

      await expect(
        service.buildRotateKeyTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the new signer equals the old signer', async () => {
      stellarService.getAccountSigners.mockResolvedValue(
        configWithTwoSigners(),
      );
      const dto: RotateKeyDto = {
        oldSignerPublicKey: oldKp.publicKey(),
        newSignerPublicKey: oldKp.publicKey(),
      };

      await expect(
        service.buildRotateKeyTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects rotating in a key that is already a signer', async () => {
      stellarService.getAccountSigners.mockResolvedValue(
        configWithTwoSigners(),
      );
      const dto: RotateKeyDto = {
        oldSignerPublicKey: oldKp.publicKey(),
        newSignerPublicKey: existingKp.publicKey(),
      };

      await expect(
        service.buildRotateKeyTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to rotate the master key through this endpoint', async () => {
      stellarService.getAccountSigners.mockResolvedValue(
        configWithTwoSigners(),
      );
      const dto: RotateKeyDto = {
        oldSignerPublicKey: accountKp.publicKey(),
        newSignerPublicKey: newKp.publicKey(),
      };

      await expect(
        service.buildRotateKeyTx(WALLET_ID, USER, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
