import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { MultisigTransactionService } from './multisig-transaction.service';
import { MultisigTransaction } from '../entities/multisig-transaction.entity';
import { MultisigSignature } from '../entities/multisig-signature.entity';
import { MultisigTransactionStatus } from '../enums/multisig-transaction-status.enum';
import { ThresholdCategory } from '../enums/threshold-category.enum';
import { WalletService } from '../wallet.service';
import { StellarService } from '../../stellar/stellar.service';
import { TransactionsService } from '../../transactions/transactions.service';
import { MultisigEvents } from '../events/multisig.events';
import { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';

const PASSPHRASE = Networks.TESTNET;
const USER: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@example.com',
  role: 'user',
};
const WALLET_ID = 'wallet-1';
const TX_ID = 'tx-1';

// The wallet's own key is the transaction source; a separate key is a cosigner.
const sourceKp = Keypair.random();
const signerKp = Keypair.random();

/** Builds a real unsigned single-payment envelope sourced from the wallet. */
function buildPaymentXdr(): string {
  const account = new Account(sourceKp.publicKey(), '100');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(3600)
    .build()
    .toXDR();
}

/** Produces a genuine base64 DecoratedSignature over the envelope's hash. */
function decoratedSigXdr(kp: Keypair, unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, PASSPHRASE);
  return kp.signDecorated(tx.hash()).toXDR('base64');
}

describe('MultisigTransactionService', () => {
  let service: MultisigTransactionService;
  let unsignedXdr: string;

  let txRepo: any;
  let sigRepo: any;
  let walletService: any;
  let stellarService: any;
  let transactionsService: any;
  let eventEmitter: any;
  let qrManager: any;
  let queryRunner: any;
  let dataSource: any;

  const wallet = {
    id: WALLET_ID,
    userId: USER.id,
    publicKey: sourceKp.publicKey(),
    status: 'active',
  };

  function makeTx(overrides: Record<string, unknown> = {}): any {
    return {
      id: TX_ID,
      walletId: WALLET_ID,
      sourceAccount: sourceKp.publicKey(),
      unsignedXdr,
      description: null,
      requiredWeight: 1,
      thresholdCategory: ThresholdCategory.MEDIUM,
      status: MultisigTransactionStatus.PENDING_SIGNATURES,
      createdByUserId: USER.id,
      networkPassphrase: PASSPHRASE,
      submittedTxHash: null,
      failureReason: null,
      expiresAt: null,
      signatures: [],
      createdAt: new Date(),
      ...overrides,
    };
  }

  const eligibleConfig = () => ({
    accountId: sourceKp.publicKey(),
    masterWeight: 1,
    thresholds: { low: 1, med: 2, high: 3 },
    signers: [
      { key: sourceKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
      { key: signerKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
    ],
  });

  beforeEach(async () => {
    unsignedXdr = buildPaymentXdr();

    qrManager = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn(async (value: unknown) => value),
      find: jest.fn().mockResolvedValue([]),
    };
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: qrManager,
    };
    dataSource = { createQueryRunner: jest.fn().mockReturnValue(queryRunner) };

    txRepo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (value: any) => ({
        id: TX_ID,
        createdAt: new Date(),
        ...value,
      })),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
    };
    sigRepo = { find: jest.fn().mockResolvedValue([]) };

    walletService = {
      findOne: jest.fn().mockResolvedValue(wallet),
      createDecoratedSignature: jest.fn(),
    };
    stellarService = {
      getNetworkInfo: jest.fn().mockReturnValue({
        network: 'testnet',
        passphrase: PASSPHRASE,
        horizonUrl: 'https://horizon-testnet.stellar.org',
      }),
      getAccountSigners: jest.fn().mockResolvedValue(eligibleConfig()),
      submitTransaction: jest.fn(),
    };
    transactionsService = { record: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultisigTransactionService,
        { provide: getRepositoryToken(MultisigTransaction), useValue: txRepo },
        { provide: getRepositoryToken(MultisigSignature), useValue: sigRepo },
        { provide: WalletService, useValue: walletService },
        { provide: StellarService, useValue: stellarService },
        { provide: TransactionsService, useValue: transactionsService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<MultisigTransactionService>(
      MultisigTransactionService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('propose', () => {
    it('pools the tx and derives required weight from the medium threshold', async () => {
      const status = await service.propose(WALLET_ID, USER, { unsignedXdr });

      expect(txRepo.save).toHaveBeenCalled();
      expect(status.requiredWeight).toBe(2);
      expect(status.thresholdCategory).toBe(ThresholdCategory.MEDIUM);
      expect(status.status).toBe(MultisigTransactionStatus.PENDING_SIGNATURES);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_PROPOSED,
        expect.objectContaining({ requiredWeight: 2 }),
      );
    });

    it('rejects a tx whose source account is not the wallet', async () => {
      walletService.findOne.mockResolvedValueOnce({
        ...wallet,
        publicKey: Keypair.random().publicKey(),
      });
      await expect(
        service.propose(WALLET_ID, USER, { unsignedXdr }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed XDR', async () => {
      await expect(
        service.propose(WALLET_ID, USER, { unsignedXdr: 'not-valid-xdr' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addSignature', () => {
    it('accepts a server-custodied signature and flips to READY at threshold', async () => {
      txRepo.findOne.mockResolvedValue(makeTx({ requiredWeight: 1 }));
      walletService.createDecoratedSignature.mockResolvedValue({
        signerPublicKey: signerKp.publicKey(),
        signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
      });
      qrManager.find.mockResolvedValue([{ weight: 1 }]);

      const status = await service.addSignature(TX_ID, USER, {
        walletId: WALLET_ID,
      });

      expect(status.status).toBe(MultisigTransactionStatus.READY);
      expect(status.isReadyToSubmit).toBe(true);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_SIGNED,
        expect.any(Object),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_READY,
        expect.any(Object),
      );
    });

    it('accepts an external signature and stays pending below threshold', async () => {
      txRepo.findOne.mockResolvedValue(makeTx({ requiredWeight: 2 }));
      qrManager.find.mockResolvedValue([{ weight: 1 }]);

      const status = await service.addSignature(TX_ID, USER, {
        signerPublicKey: signerKp.publicKey(),
        signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
      });

      expect(status.status).toBe(MultisigTransactionStatus.PENDING_SIGNATURES);
      expect(status.isReadyToSubmit).toBe(false);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_SIGNED,
        expect.any(Object),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_READY,
        expect.any(Object),
      );
    });

    it('rejects a signer that is not eligible on the account', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      stellarService.getAccountSigners.mockResolvedValue({
        ...eligibleConfig(),
        signers: [
          { key: sourceKp.publicKey(), weight: 1, type: 'ed25519_public_key' },
        ],
      });

      await expect(
        service.addSignature(TX_ID, USER, {
          signerPublicKey: signerKp.publicKey(),
          signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a signature that does not verify against the tx', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      // Eligible signer key, but the signature was produced by a different key.
      const wrongSig = decoratedSigXdr(Keypair.random(), unsignedXdr);

      await expect(
        service.addSignature(TX_ID, USER, {
          signerPublicKey: signerKp.publicKey(),
          signatureXdr: wrongSig,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate signature from the same signer', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      qrManager.findOne.mockResolvedValue({ id: 'existing-signature' });

      await expect(
        service.addSignature(TX_ID, USER, {
          signerPublicKey: signerKp.publicKey(),
          signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
        }),
      ).rejects.toThrow(ConflictException);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('rejects when both signing modes are supplied', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      await expect(
        service.addSignature(TX_ID, USER, {
          walletId: WALLET_ID,
          signerPublicKey: signerKp.publicKey(),
          signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when neither signing mode is supplied', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      await expect(service.addSignature(TX_ID, USER, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects adding a signature to a non-pending tx', async () => {
      txRepo.findOne.mockResolvedValue(
        makeTx({ status: MultisigTransactionStatus.READY }),
      );
      await expect(
        service.addSignature(TX_ID, USER, { walletId: WALLET_ID }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('broadcast', () => {
    const readyTxWithSignature = () =>
      makeTx({
        status: MultisigTransactionStatus.READY,
        signatures: [
          {
            signerPublicKey: signerKp.publicKey(),
            signatureXdr: decoratedSigXdr(signerKp, unsignedXdr),
            weight: 1,
            signedByUserId: null,
            createdAt: new Date(),
          },
        ],
      });

    it('refuses to broadcast a tx that is not READY', async () => {
      txRepo.findOne.mockResolvedValue(
        makeTx({ status: MultisigTransactionStatus.PENDING_SIGNATURES }),
      );
      await expect(service.broadcast(TX_ID, USER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects re-broadcasting an already submitted tx', async () => {
      txRepo.findOne.mockResolvedValue(
        makeTx({ status: MultisigTransactionStatus.SUBMITTED }),
      );
      await expect(service.broadcast(TX_ID, USER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('reassembles signatures, submits, and records to history', async () => {
      txRepo.findOne.mockResolvedValue(readyTxWithSignature());
      stellarService.submitTransaction.mockResolvedValue({
        hash: 'HASH123',
        successful: true,
        ledger: 5,
      });

      const status = await service.broadcast(TX_ID, USER);

      expect(stellarService.submitTransaction).toHaveBeenCalled();
      expect(status.status).toBe(MultisigTransactionStatus.SUBMITTED);
      expect(status.submittedTxHash).toBe('HASH123');
      expect(transactionsService.record).toHaveBeenCalledWith(
        expect.objectContaining({ stellarTxHash: 'HASH123' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_SUBMITTED,
        expect.objectContaining({ hash: 'HASH123' }),
      );
    });

    it('marks the tx FAILED and rethrows when submission is rejected', async () => {
      const tx = readyTxWithSignature();
      txRepo.findOne.mockResolvedValue(tx);
      stellarService.submitTransaction.mockRejectedValue(
        new Error('tx_bad_auth'),
      );

      await expect(service.broadcast(TX_ID, USER)).rejects.toThrow(
        'tx_bad_auth',
      );
      expect(tx.status).toBe(MultisigTransactionStatus.FAILED);
      expect(tx.failureReason).toContain('tx_bad_auth');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        MultisigEvents.TRANSACTION_FAILED,
        expect.any(Object),
      );
    });
  });

  describe('list', () => {
    it('returns paginated results filtered by status', async () => {
      txRepo.findAndCount.mockResolvedValue([[makeTx()], 1]);

      const result = await service.list(WALLET_ID, USER, {
        page: 1,
        limit: 20,
        skip: 0,
        status: MultisigTransactionStatus.PENDING_SIGNATURES,
      } as any);

      expect(txRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            walletId: WALLET_ID,
            status: MultisigTransactionStatus.PENDING_SIGNATURES,
          },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('cancel', () => {
    it('cancels a pending tx', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      const status = await service.cancel(TX_ID, USER);
      expect(status.status).toBe(MultisigTransactionStatus.CANCELLED);
    });

    it('refuses to cancel a tx that is not pending', async () => {
      txRepo.findOne.mockResolvedValue(
        makeTx({ status: MultisigTransactionStatus.READY }),
      );
      await expect(service.cancel(TX_ID, USER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getStatus', () => {
    it('returns the current status for the owner', async () => {
      txRepo.findOne.mockResolvedValue(makeTx());
      const status = await service.getStatus(TX_ID, USER);
      expect(status.id).toBe(TX_ID);
      expect(walletService.findOne).toHaveBeenCalledWith(WALLET_ID, USER.id);
    });

    it('throws NotFound when the tx does not exist', async () => {
      txRepo.findOne.mockResolvedValue(null);
      await expect(service.getStatus('missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
