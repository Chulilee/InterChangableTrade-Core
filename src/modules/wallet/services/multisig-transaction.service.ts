import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { PaginatedResultDto } from '@app/common';
import { StellarService } from '../../stellar/stellar.service';
import { TransactionsService } from '../../transactions/transactions.service';
import {
  TransactionStatus,
  TransactionType,
} from '../../transactions/entities/transaction.entity';
import { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { WalletService } from '../wallet.service';
import { MultisigTransaction } from '../entities/multisig-transaction.entity';
import { MultisigSignature } from '../entities/multisig-signature.entity';
import { MultisigTransactionStatus } from '../enums/multisig-transaction-status.enum';
import { ThresholdCategory } from '../enums/threshold-category.enum';
import { ProposeMultisigTxDto } from '../dto/propose-multisig-tx.dto';
import { AddSignatureDto } from '../dto/add-signature.dto';
import { QueryMultisigTxDto } from '../dto/query-multisig-tx.dto';
import { MultisigEvents } from '../events/multisig.events';

/** Operation types that require the account's high threshold. */
const HIGH_THRESHOLD_OPS = new Set(['setOptions', 'accountMerge']);
/** Operation types that require only the account's low threshold. */
const LOW_THRESHOLD_OPS = new Set([
  'allowTrust',
  'bumpSequence',
  'setTrustLineFlags',
]);

/** A signature as returned in a status view (no raw XDR). */
export interface MultisigSignatureView {
  signerPublicKey: string;
  weight: number;
  signedByUserId?: string | null;
  signedAt: Date;
}

/** The partial-signature state of a pooled transaction. */
export interface MultisigTxStatus {
  id: string;
  walletId: string;
  sourceAccount: string;
  status: MultisigTransactionStatus;
  thresholdCategory: ThresholdCategory;
  description?: string | null;
  requiredWeight: number;
  currentWeight: number;
  isReadyToSubmit: boolean;
  submittedTxHash?: string | null;
  failureReason?: string | null;
  expiresAt?: Date | null;
  createdByUserId: string;
  createdAt: Date;
  signatures: MultisigSignatureView[];
}

/**
 * The multi-signature signing pipeline. A transaction is proposed once (its
 * unsigned envelope stored immutably), signatures are pooled as independent
 * decorated signatures, each validated in sub-second time, and once the
 * accumulated weight meets the account threshold the transaction is reassembled
 * and broadcast — then recorded to transaction history.
 */
@Injectable()
export class MultisigTransactionService {
  private readonly logger = new Logger(MultisigTransactionService.name);

  constructor(
    @InjectRepository(MultisigTransaction)
    private readonly txRepo: Repository<MultisigTransaction>,
    @InjectRepository(MultisigSignature)
    private readonly sigRepo: Repository<MultisigSignature>,
    private readonly walletService: WalletService,
    private readonly stellarService: StellarService,
    private readonly transactionsService: TransactionsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Propose ───────────────────────────────────────────────────────────────

  /**
   * Adds an unsigned transaction to the signing pool for a wallet the caller
   * owns. Derives the required weight and eligible signers from the account's
   * on-chain config and captures the transaction's expiry from its timebounds.
   */
  async propose(
    walletId: string,
    user: AuthenticatedUser,
    dto: ProposeMultisigTxDto,
  ): Promise<MultisigTxStatus> {
    const wallet = await this.walletService.findOne(walletId, user.id);
    const passphrase = this.stellarService.getNetworkInfo().passphrase;

    const tx = this.parseClassicTransaction(dto.unsignedXdr, passphrase);

    if (tx.operations.length === 0) {
      throw new BadRequestException('Transaction has no operations');
    }
    if (tx.source !== wallet.publicKey) {
      throw new BadRequestException(
        'Transaction source account does not match the wallet',
      );
    }

    const category = this.determineThresholdCategory(tx);
    const config = await this.stellarService.getAccountSigners(
      wallet.publicKey,
    );
    const requiredWeight = this.requiredWeightForCategory(category, config);
    const expiresAt = this.extractExpiry(tx);

    const entity = this.txRepo.create({
      walletId: wallet.id,
      sourceAccount: wallet.publicKey,
      unsignedXdr: dto.unsignedXdr,
      description: dto.description ?? null,
      requiredWeight,
      thresholdCategory: category,
      status: MultisigTransactionStatus.PENDING_SIGNATURES,
      createdByUserId: user.id,
      networkPassphrase: passphrase,
      expiresAt,
    });
    const saved = await this.txRepo.save(entity);

    this.eventEmitter.emit(MultisigEvents.TRANSACTION_PROPOSED, {
      transactionId: saved.id,
      walletId: wallet.id,
      requiredWeight,
      thresholdCategory: category,
      createdByUserId: user.id,
    });

    this.logger.log(
      `Multi-sig tx ${saved.id} proposed for wallet ${walletId} (required weight ${requiredWeight}, ${category})`,
    );
    return this.buildStatus(saved, []);
  }

  // ─── Add Signature ──────────────────────────────────────────────────────────

  /**
   * Collects one signature into the pool. Supports a server-custodied signer
   * (`walletId`) or an externally-produced decorated signature
   * (`signerPublicKey` + `signatureXdr`). Every signature is checked for signer
   * eligibility, verified cryptographically against the transaction hash, and
   * rejected if duplicated. When the accumulated weight reaches the threshold,
   * the transaction flips to READY.
   */
  async addSignature(
    txId: string,
    user: AuthenticatedUser,
    dto: AddSignatureDto,
  ): Promise<MultisigTxStatus> {
    const tx = await this.getTxOrThrow(txId);

    if (tx.status !== MultisigTransactionStatus.PENDING_SIGNATURES) {
      throw new BadRequestException(
        `Cannot add signatures to a transaction in status ${tx.status}`,
      );
    }
    await this.expireIfElapsed(tx);

    const { signerPublicKey, signatureXdr, signedByUserId } =
      await this.resolveSignature(tx, user, dto);

    // Eligibility: the signer must be a current on-chain signer with weight.
    const config = await this.stellarService.getAccountSigners(
      tx.sourceAccount,
    );
    const signerEntry = config.signers.find(
      (s) => s.key === signerPublicKey && s.weight > 0,
    );
    if (!signerEntry) {
      throw new ForbiddenException(
        `${signerPublicKey} is not an eligible signer on this account`,
      );
    }

    // Cryptographic validation — a pure ed25519 verify against the tx hash,
    // completing well within the sub-second budget.
    const rebuilt = TransactionBuilder.fromXDR(
      tx.unsignedXdr,
      tx.networkPassphrase,
    );
    if (
      !this.verifyDecoratedSignature(signerPublicKey, signatureXdr, rebuilt)
    ) {
      throw new BadRequestException(
        'Signature does not verify against the transaction',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let becameReady = false;
    let signatures: MultisigSignature[];
    try {
      const existing = await queryRunner.manager.findOne(MultisigSignature, {
        where: { transactionId: tx.id, signerPublicKey },
      });
      if (existing) {
        throw new ConflictException(
          `${signerPublicKey} has already signed this transaction`,
        );
      }

      const signature = queryRunner.manager.create(MultisigSignature, {
        transactionId: tx.id,
        signerPublicKey,
        signatureXdr,
        weight: signerEntry.weight,
        signedByUserId,
      });
      await queryRunner.manager.save(signature);

      signatures = await queryRunner.manager.find(MultisigSignature, {
        where: { transactionId: tx.id },
      });
      const currentWeight = signatures.reduce((sum, s) => sum + s.weight, 0);

      if (currentWeight >= tx.requiredWeight) {
        tx.status = MultisigTransactionStatus.READY;
        await queryRunner.manager.save(tx);
        becameReady = true;
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Events after commit.
    this.eventEmitter.emit(MultisigEvents.TRANSACTION_SIGNED, {
      transactionId: tx.id,
      signerPublicKey,
      weight: signerEntry.weight,
    });
    if (becameReady) {
      this.eventEmitter.emit(MultisigEvents.TRANSACTION_READY, {
        transactionId: tx.id,
      });
    }

    this.logger.log(
      `Signature from ${signerPublicKey} (weight ${signerEntry.weight}) added to tx ${tx.id}${
        becameReady ? ' — now READY' : ''
      }`,
    );
    return this.buildStatus(tx, signatures);
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  /** Returns the current partial-signature state of a pooled transaction. */
  async getStatus(
    txId: string,
    user: AuthenticatedUser,
  ): Promise<MultisigTxStatus> {
    const tx = await this.getTxOrThrow(txId);
    await this.walletService.findOne(tx.walletId, user.id);
    return this.buildStatus(tx, tx.signatures ?? []);
  }

  // ─── List ────────────────────────────────────────────────────────────────

  /** Lists a wallet's pooled transactions (paginated, optional status filter). */
  async list(
    walletId: string,
    user: AuthenticatedUser,
    query: QueryMultisigTxDto,
  ): Promise<PaginatedResultDto<MultisigTransaction>> {
    await this.walletService.findOne(walletId, user.id);

    const where = query.status
      ? { walletId, status: query.status }
      : { walletId };

    const [data, total] = await this.txRepo.findAndCount({
      where,
      skip: query.skip,
      take: query.limit,
      order: { createdAt: 'DESC' },
    });
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  // ─── Broadcast ─────────────────────────────────────────────────────────────

  /**
   * Reassembles the pooled signatures onto the base transaction and submits it.
   * Refuses unless the transaction is READY. Records the resulting hash to
   * transaction history on success, or captures the failure reason on rejection.
   */
  async broadcast(
    txId: string,
    user: AuthenticatedUser,
  ): Promise<MultisigTxStatus> {
    const tx = await this.getTxOrThrow(txId);
    await this.walletService.findOne(tx.walletId, user.id);

    if (tx.status === MultisigTransactionStatus.SUBMITTED) {
      throw new ConflictException('Transaction has already been submitted');
    }
    if (tx.status !== MultisigTransactionStatus.READY) {
      throw new BadRequestException(
        `Transaction is not ready to broadcast (status: ${tx.status})`,
      );
    }
    await this.expireIfElapsed(tx);

    const signatures =
      tx.signatures ??
      (await this.sigRepo.find({ where: { transactionId: tx.id } }));

    const rebuilt = TransactionBuilder.fromXDR(
      tx.unsignedXdr,
      tx.networkPassphrase,
    );
    for (const s of signatures) {
      rebuilt.addDecoratedSignature(
        xdr.DecoratedSignature.fromXDR(s.signatureXdr, 'base64'),
      );
    }
    const signedXdr = rebuilt.toEnvelope().toXDR('base64');

    try {
      const result = await this.stellarService.submitTransaction(signedXdr);
      tx.status = MultisigTransactionStatus.SUBMITTED;
      tx.submittedTxHash = result.hash;
      tx.failureReason = null;
      await this.txRepo.save(tx);

      await this.recordToHistory(tx, result.hash);

      this.eventEmitter.emit(MultisigEvents.TRANSACTION_SUBMITTED, {
        transactionId: tx.id,
        hash: result.hash,
      });
      this.logger.log(`Multi-sig tx ${tx.id} submitted: ${result.hash}`);
      return this.buildStatus(tx, signatures);
    } catch (error) {
      tx.status = MultisigTransactionStatus.FAILED;
      tx.failureReason = (error as Error).message;
      await this.txRepo.save(tx);

      this.eventEmitter.emit(MultisigEvents.TRANSACTION_FAILED, {
        transactionId: tx.id,
        reason: tx.failureReason,
      });
      this.logger.warn(
        `Multi-sig tx ${tx.id} failed to submit: ${tx.failureReason}`,
      );
      throw error;
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────

  /** Cancels a pending transaction. Owner-only; only before broadcast. */
  async cancel(
    txId: string,
    user: AuthenticatedUser,
  ): Promise<MultisigTxStatus> {
    const tx = await this.getTxOrThrow(txId);
    await this.walletService.findOne(tx.walletId, user.id);

    if (tx.status !== MultisigTransactionStatus.PENDING_SIGNATURES) {
      throw new BadRequestException(
        `Cannot cancel a transaction in status ${tx.status}`,
      );
    }

    tx.status = MultisigTransactionStatus.CANCELLED;
    const saved = await this.txRepo.save(tx);
    this.logger.log(`Multi-sig tx ${tx.id} cancelled by ${user.id}`);
    return this.buildStatus(saved, tx.signatures ?? []);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getTxOrThrow(txId: string): Promise<MultisigTransaction> {
    const tx = await this.txRepo.findOne({
      where: { id: txId },
      relations: ['signatures'],
    });
    if (!tx) {
      throw new NotFoundException(`Multi-sig transaction ${txId} not found`);
    }
    return tx;
  }

  /**
   * Lazily transitions a transaction to EXPIRED if its timebounds have elapsed,
   * then rejects the caller's action.
   */
  private async expireIfElapsed(tx: MultisigTransaction): Promise<void> {
    if (tx.expiresAt && tx.expiresAt.getTime() <= Date.now()) {
      tx.status = MultisigTransactionStatus.EXPIRED;
      await this.txRepo.save(tx);
      throw new BadRequestException(
        'Transaction has expired (timebounds elapsed) and can no longer be signed or broadcast',
      );
    }
  }

  /**
   * Resolves the signature to record from either signing mode, enforcing that
   * exactly one mode is supplied.
   */
  private async resolveSignature(
    tx: MultisigTransaction,
    user: AuthenticatedUser,
    dto: AddSignatureDto,
  ): Promise<{
    signerPublicKey: string;
    signatureXdr: string;
    signedByUserId: string | null;
  }> {
    const serverMode = !!dto.walletId;
    const externalMode = !!dto.signerPublicKey || !!dto.signatureXdr;

    if (serverMode && externalMode) {
      throw new BadRequestException(
        'Provide either walletId (server-side) or signerPublicKey + signatureXdr (external), not both',
      );
    }
    if (!serverMode && !externalMode) {
      throw new BadRequestException(
        'Provide either walletId (server-side) or signerPublicKey + signatureXdr (external)',
      );
    }

    if (serverMode) {
      const result = await this.walletService.createDecoratedSignature(
        dto.walletId!,
        user.id,
        tx.unsignedXdr,
      );
      return {
        signerPublicKey: result.signerPublicKey,
        signatureXdr: result.signatureXdr,
        signedByUserId: user.id,
      };
    }

    if (!dto.signerPublicKey || !dto.signatureXdr) {
      throw new BadRequestException(
        'Both signerPublicKey and signatureXdr are required for an external signature',
      );
    }
    return {
      signerPublicKey: dto.signerPublicKey,
      signatureXdr: dto.signatureXdr,
      signedByUserId: null,
    };
  }

  /** Parses XDR, rejecting anything that is not a classic (non-fee-bump) tx. */
  private parseClassicTransaction(
    unsignedXdr: string,
    passphrase: string,
  ): Transaction {
    let parsed: Transaction | FeeBumpTransaction;
    try {
      parsed = TransactionBuilder.fromXDR(unsignedXdr, passphrase);
    } catch {
      throw new BadRequestException(
        'unsignedXdr is not a valid transaction envelope for this network',
      );
    }
    if (parsed instanceof FeeBumpTransaction) {
      throw new BadRequestException(
        'Fee-bump transactions are not supported in the signing pool',
      );
    }
    return parsed;
  }

  /** Highest threshold category among a transaction's operations. */
  private determineThresholdCategory(tx: Transaction): ThresholdCategory {
    let rank = 0; // 0 = low, 1 = medium, 2 = high
    for (const op of tx.operations) {
      const opRank = HIGH_THRESHOLD_OPS.has(op.type)
        ? 2
        : LOW_THRESHOLD_OPS.has(op.type)
          ? 0
          : 1;
      if (opRank > rank) rank = opRank;
    }
    if (rank === 2) return ThresholdCategory.HIGH;
    if (rank === 0) return ThresholdCategory.LOW;
    return ThresholdCategory.MEDIUM;
  }

  /**
   * The weight a transaction of the given category must accumulate. A threshold
   * of 0 on-chain means the default master weight (1) authorises, so we floor at
   * 1 to avoid a zero requirement.
   */
  private requiredWeightForCategory(
    category: ThresholdCategory,
    config: { thresholds: { low: number; med: number; high: number } },
  ): number {
    const t = config.thresholds;
    const threshold =
      category === ThresholdCategory.HIGH
        ? t.high
        : category === ThresholdCategory.LOW
          ? t.low
          : t.med;
    return Math.max(threshold, 1);
  }

  /** Upper timebound as a Date, or null when the transaction never expires. */
  private extractExpiry(tx: Transaction): Date | null {
    const maxTime = tx.timeBounds?.maxTime;
    if (maxTime && maxTime !== '0') {
      return new Date(parseInt(maxTime, 10) * 1000);
    }
    return null;
  }

  /**
   * Verifies a base64 decorated signature against a transaction's hash using the
   * signer's public key. Returns false (rather than throwing) on any malformed
   * input so the caller can surface a clean 400.
   */
  private verifyDecoratedSignature(
    signerPublicKey: string,
    signatureXdr: string,
    tx: Transaction | FeeBumpTransaction,
  ): boolean {
    try {
      const decorated = xdr.DecoratedSignature.fromXDR(signatureXdr, 'base64');
      return Keypair.fromPublicKey(signerPublicKey).verify(
        tx.hash(),
        decorated.signature(),
      );
    } catch {
      return false;
    }
  }

  /** Records a broadcast multi-sig transaction to the shared history. */
  private async recordToHistory(
    tx: MultisigTransaction,
    hash: string,
  ): Promise<void> {
    try {
      await this.transactionsService.record({
        stellarTxHash: hash,
        userId: tx.createdByUserId,
        type: TransactionType.OTHER,
        status: TransactionStatus.SUCCESS,
        fromAccount: tx.sourceAccount,
        assetCode: 'XLM',
        amount: '0',
      });
    } catch (error) {
      // History is a secondary concern — never fail a successful broadcast
      // because the audit record could not be written.
      this.logger.warn(
        `Failed to record multi-sig tx ${tx.id} to history: ${(error as Error).message}`,
      );
    }
  }

  private buildStatus(
    tx: MultisigTransaction,
    signatures: MultisigSignature[],
  ): MultisigTxStatus {
    const currentWeight = signatures.reduce((sum, s) => sum + s.weight, 0);
    return {
      id: tx.id,
      walletId: tx.walletId,
      sourceAccount: tx.sourceAccount,
      status: tx.status,
      thresholdCategory: tx.thresholdCategory,
      description: tx.description,
      requiredWeight: tx.requiredWeight,
      currentWeight,
      isReadyToSubmit: tx.status === MultisigTransactionStatus.READY,
      submittedTxHash: tx.submittedTxHash,
      failureReason: tx.failureReason,
      expiresAt: tx.expiresAt,
      createdByUserId: tx.createdByUserId,
      createdAt: tx.createdAt,
      signatures: signatures.map((s) => ({
        signerPublicKey: s.signerPublicKey,
        weight: s.weight,
        signedByUserId: s.signedByUserId,
        signedAt: s.createdAt,
      })),
    };
  }
}
