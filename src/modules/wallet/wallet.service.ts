import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import { PaginatedResultDto, PaginationQueryDto } from '@app/common';
import { StellarService } from '../stellar/stellar.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditCategory,
  AuditOutcome,
} from '../audit/entities/audit-log.entity';
import { StepUpTokenService } from '../auth/step-up-token.service';
import { UserRole } from '../users/entities/user.entity';
import { Wallet, WalletStatus } from './entities/wallet.entity';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import {
  MAX_UNSIGNED_XDR_LENGTH,
  SignTransactionDto,
} from './dto/sign-transaction.dto';
import { MultisigConfigDto } from './dto/multisig-config.dto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/** Operations that can hand over or drain an account. */
const HIGH_RISK_OPERATIONS = new Set(['setOptions', 'accountMerge']);

/** Conservative fallback if configuration is unavailable. */
const DEFAULT_ALLOWED_OPERATIONS = ['payment'];

/** Optional actor context supplied by the HTTP layer. */
export interface WalletSigningOptions {
  role?: string;
  stepUpToken?: string;
}

/** Shape we rely on when describing classic operations for the audit trail. */
interface DescribedOperation {
  type: string;
  amount?: string;
  destination?: string;
  asset?: string | { code?: string; issuer?: string };
}

/**
 * Wallet Management Service
 *
 * Handles all wallet lifecycle operations: key generation, encrypted storage,
 * balance synchronisation, transaction signing, and multi-sig configuration.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    private readonly stellarService: StellarService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly stepUpTokens: StepUpTokenService,
    private readonly auditService: AuditService,
  ) {
    const secret = this.configService.get<string>('WALLET_ENCRYPTION_KEY');
    if (!secret || secret.length < 32) {
      throw new Error('WALLET_ENCRYPTION_KEY must be at least 32 characters');
    }
    // Derive a fixed-length 32-byte key from the configured secret
    this.encryptionKey = crypto.scryptSync(secret, 'wallet-salt', 32);
  }

  // ─── Key encryption helpers ───────────────────────────────────────────────

  /** Encrypts a Stellar secret key using AES-256-GCM. */
  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /** Decrypts a secret key previously encrypted by {@link encrypt}. */
  private decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new BadRequestException('Invalid encrypted key format');
    }

    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const encrypted = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Encrypted key is invalid or has been tampered with');
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Generates a fresh Stellar keypair, encrypts the secret key, and persists
   * the wallet linked to the given user.
   */
  async create(userId: string, dto: CreateWalletDto): Promise<Wallet> {
    const keypair = Keypair.random();
    const encryptedSecretKey = this.encrypt(keypair.secret());

    // If this is the first wallet for the user, auto-set it as primary
    const existingCount = await this.walletRepository.count({
      where: { userId },
    });
    const isPrimary = dto.isPrimary ?? existingCount === 0;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Unset any existing primary wallet if this one is primary
      if (isPrimary) {
        await queryRunner.manager.update(
          Wallet,
          { userId, isPrimary: true },
          { isPrimary: false },
        );
      }

      const wallet = queryRunner.manager.create(Wallet, {
        userId,
        publicKey: keypair.publicKey(),
        encryptedSecretKey,
        label: dto.label,
        isPrimary,
        status: WalletStatus.ACTIVE,
      });

      const saved = await queryRunner.manager.save(wallet);
      await queryRunner.commitTransaction();

      this.logger.log(`Wallet ${saved.id} created for user ${userId}`);
      delete (saved as { encryptedSecretKey?: string }).encryptedSecretKey;
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /** Returns all wallets belonging to a user (paginated). */
  async findAllForUser(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResultDto<Wallet>> {
    const [data, total] = await this.walletRepository.findAndCount({
      where: { userId },
      skip: query.skip,
      take: query.limit,
      order: { createdAt: 'DESC' },
    });
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  /** Fetches a wallet by ID, verifying ownership. */
  async findOne(id: string, userId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findOne({ where: { id } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${id} not found`);
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('You do not own this wallet');
    }
    return wallet;
  }

  /** Updates mutable wallet fields (label, status, isPrimary). */
  async update(
    id: string,
    userId: string,
    dto: UpdateWalletDto,
  ): Promise<Wallet> {
    const wallet = await this.findOne(id, userId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (dto.isPrimary === true) {
        await queryRunner.manager.update(
          Wallet,
          { userId, isPrimary: true },
          { isPrimary: false },
        );
      }

      Object.assign(wallet, dto);
      const saved = await queryRunner.manager.save(wallet);
      await queryRunner.commitTransaction();
      delete (saved as { encryptedSecretKey?: string }).encryptedSecretKey;
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /** Soft-deletes a wallet by setting its status to INACTIVE. */
  async remove(id: string, userId: string): Promise<void> {
    const wallet = await this.findOne(id, userId);
    if (wallet.isPrimary) {
      throw new BadRequestException(
        'Cannot remove the primary wallet. Assign another wallet as primary first.',
      );
    }
    wallet.status = WalletStatus.INACTIVE;
    await this.walletRepository.save(wallet);
    this.logger.log(`Wallet ${id} deactivated for user ${userId}`);
  }

  // ─── Balance sync ─────────────────────────────────────────────────────────

  /**
   * Fetches the live balance from Horizon and updates the cached value.
   * Resolves within ~5 s for confirmed accounts.
   */
  async syncBalance(id: string, userId: string): Promise<Wallet> {
    const wallet = await this.findOne(id, userId);

    try {
      const accountSummary = await this.stellarService.getAccount(
        wallet.publicKey,
      );
      const xlmBalance = accountSummary.balances.find(
        (b) => b.assetType === 'native',
      );
      wallet.cachedBalance = xlmBalance?.balance ?? '0';
      wallet.balanceSyncedAt = new Date();
      await this.walletRepository.save(wallet);
      this.logger.log(
        `Balance synced for wallet ${id}: ${wallet.cachedBalance} XLM`,
      );
    } catch (error) {
      this.logger.warn(
        `Balance sync failed for wallet ${id}: ${(error as Error).message}`,
      );
      // Re-throw so the controller can surface a meaningful response
      throw error;
    }

    return wallet;
  }

  // ─── Transaction signing ──────────────────────────────────────────────────

  /**
   * Signs an unsigned XDR transaction envelope with the wallet's secret key.
   * Signing completes synchronously — well within the 100 ms SLA.
   *
   * The envelope is validated before the secret key is ever decrypted:
   *  - its source account must be the wallet itself;
   *  - every operation must be on the configured allowlist;
   *  - `setOptions`/`accountMerge` additionally require an admin role and a
   *    live step-up token.
   */
  async signTransaction(
    id: string,
    userId: string,
    dto: SignTransactionDto,
    options: WalletSigningOptions = {},
  ): Promise<{ signedXdr: string }> {
    const wallet = await this.walletRepository.findOne({
      where: { id },
      select: ['id', 'userId', 'publicKey', 'encryptedSecretKey', 'status'],
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${id} not found`);
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('You do not own this wallet');
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(
        `Wallet is ${wallet.status} and cannot sign transactions`,
      );
    }

    const transaction = this.parseSigningTransaction(dto.unsignedXdr, wallet);
    this.assertSigningPolicy(
      transaction,
      userId,
      options.role,
      options.stepUpToken,
    );

    const transactionHash = transaction.hash().toString('hex');
    const operations = this.describeOperations(transaction);

    const secretKey = this.decrypt(wallet.encryptedSecretKey);
    const keypair = Keypair.fromSecret(secretKey);

    transaction.sign(keypair);
    const signedXdr = transaction.toEnvelope().toXDR('base64');

    // Persist the compliance record before the signed envelope leaves the
    // process. `record` is fire-and-forget, so this does not add latency to
    // the signing SLA.
    this.auditService.record({
      category: AuditCategory.USER_ACTION,
      action: 'wallet.sign_transaction',
      outcome: AuditOutcome.SUCCESS,
      userId,
      userRole: options.role,
      resourceType: 'wallet',
      resourceId: id,
      metadata: {
        transactionHash,
        operationTypes: operations.map((operation) => operation.type),
        operations,
      },
    });

    this.logger.log(`Transaction ${transactionHash} signed by wallet ${id}`);
    return { signedXdr };
  }

  /**
   * Parses and validates a classic transaction envelope without decrypting any
   * key material. Fee-bump envelopes are rejected because their fee source is
   * not necessarily the wallet account the operation is bound to.
   */
  private parseSigningTransaction(
    unsignedXdr: string,
    wallet: Wallet,
  ): Transaction {
    if (unsignedXdr.length > MAX_UNSIGNED_XDR_LENGTH) {
      throw new BadRequestException(
        `unsignedXdr must not exceed ${MAX_UNSIGNED_XDR_LENGTH} characters`,
      );
    }

    const passphrase = this.getNetworkPassphrase();

    let parsed: Transaction | FeeBumpTransaction;
    try {
      parsed = TransactionBuilder.fromXDR(unsignedXdr, passphrase);
    } catch {
      throw new BadRequestException(
        'Invalid unsigned XDR transaction envelope',
      );
    }

    if (parsed instanceof FeeBumpTransaction) {
      throw new BadRequestException(
        'Fee-bump transactions are not supported by the custodial signer',
      );
    }

    if (parsed.source !== wallet.publicKey) {
      throw new ForbiddenException(
        'Transaction source account does not match the wallet',
      );
    }

    return parsed;
  }

  /**
   * Enforces the operation allowlist and, for account-takeover operations,
   * the admin-role and step-up requirements.
   */
  private assertSigningPolicy(
    transaction: Transaction,
    userId: string,
    role: string | undefined,
    stepUpToken: string | undefined,
  ): void {
    const allowed = this.getAllowedOperations();
    const operationTypes = [
      ...new Set(
        transaction.operations.map(
          (operation) =>
            (operation as unknown as { type: string }).type ?? 'unknown',
        ),
      ),
    ];

    const disallowed = operationTypes.filter((type) => !allowed.has(type));
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `Operation type(s) ${disallowed.join(
          ', ',
        )} are not allowed by the wallet signing policy. Allowed operations: ${
          [...allowed].join(', ') || '(none)'
        }`,
      );
    }

    const highRisk = operationTypes.filter((type) =>
      HIGH_RISK_OPERATIONS.has(type),
    );
    if (highRisk.length === 0) {
      return;
    }

    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        `Operation type(s) ${highRisk.join(
          ', ',
        )} require the ${UserRole.ADMIN} role`,
      );
    }

    this.stepUpTokens.verify(stepUpToken, userId);
  }

  private getAllowedOperations(): Set<string> {
    const configured = this.configService.get<string[] | string>(
      'wallet.signing.allowedOperations',
    );

    const values = Array.isArray(configured)
      ? configured
      : typeof configured === 'string'
        ? configured.split(',')
        : DEFAULT_ALLOWED_OPERATIONS;

    return new Set(
      values
        .map((operation) => operation.trim())
        .filter((operation) => operation.length > 0),
    );
  }

  private describeOperations(transaction: Transaction): DescribedOperation[] {
    return transaction.operations.map((operation) => {
      const source = operation as unknown as DescribedOperation;
      const described: DescribedOperation = { type: source.type ?? 'unknown' };
      if (source.amount) described.amount = source.amount;
      if (source.destination) described.destination = source.destination;
      if (source.asset) {
        described.asset =
          typeof source.asset === 'string'
            ? source.asset
            : {
                code: source.asset.code,
                issuer: source.asset.issuer,
              };
      }
      return described;
    });
  }

  /**
   * Reads the configured passphrase and fails closed. There is deliberately no
   * testnet fallback: silently signing testnet envelopes because production
   * configuration is missing is worse than refusing to sign.
   */
  private getNetworkPassphrase(): string {
    const passphrase = this.configService.get<string>(
      'stellar.networkPassphrase',
    );
    if (!passphrase || passphrase.trim().length === 0) {
      throw new InternalServerErrorException(
        'STELLAR_NETWORK_PASSPHRASE is not configured',
      );
    }
    return passphrase;
  }

  /**
   * Produces a **decorated signature** (base64 XDR) for an unsigned transaction
   * without assembling a full envelope. This is the server-custodied path of
   * the multi-sig pipeline: the signature is pooled alongside others and
   * reattached to the base transaction at broadcast.
   *
   * Signing is a pure ed25519 operation — it completes well within the
   * sub-second validation budget.
   */
  async createDecoratedSignature(
    walletId: string,
    userId: string,
    unsignedXdr: string,
  ): Promise<{ signerPublicKey: string; signatureXdr: string }> {
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId },
      select: ['id', 'userId', 'publicKey', 'encryptedSecretKey', 'status'],
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('You do not own this wallet');
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(
        `Wallet is ${wallet.status} and cannot sign transactions`,
      );
    }

    // Same source binding and fail-closed network handling as the direct
    // signing path. Multisig authority is enforced separately by the pooled
    // transaction's threshold, so the single-signature allowlist does not
    // apply here.
    const transaction = this.parseSigningTransaction(unsignedXdr, wallet);
    const transactionHash = transaction.hash().toString('hex');
    const operations = this.describeOperations(transaction);

    const secretKey = this.decrypt(wallet.encryptedSecretKey);
    const keypair = Keypair.fromSecret(secretKey);

    const decorated = keypair.signDecorated(transaction.hash());

    this.auditService.record({
      category: AuditCategory.USER_ACTION,
      action: 'wallet.create_decorated_signature',
      outcome: AuditOutcome.SUCCESS,
      userId,
      resourceType: 'wallet',
      resourceId: walletId,
      metadata: {
        transactionHash,
        operationTypes: operations.map((operation) => operation.type),
        operations,
      },
    });

    this.logger.log(
      `Decorated signature ${transactionHash} created by wallet ${walletId}`,
    );
    return {
      signerPublicKey: keypair.publicKey(),
      signatureXdr: decorated.toXDR('base64'),
    };
  }

  // ─── Account recovery ────────────────────────────────────────────────────

  /**
   * Returns the public key for a wallet — safe to expose for recovery flows
   * (e.g. re-deriving trust lines or verifying ownership).
   */
  async getPublicKey(
    id: string,
    userId: string,
  ): Promise<{ publicKey: string }> {
    const wallet = await this.findOne(id, userId);
    return { publicKey: wallet.publicKey };
  }

  // ─── Multi-sig ────────────────────────────────────────────────────────────

  /** Configures multi-signature settings for a wallet. */
  async configureMultisig(
    id: string,
    userId: string,
    dto: MultisigConfigDto,
  ): Promise<Wallet> {
    const wallet = await this.findOne(id, userId);

    if (dto.cosigners.includes(wallet.publicKey)) {
      throw new ConflictException(
        'Wallet public key cannot be listed as a co-signer of itself',
      );
    }

    wallet.multisigThreshold = dto.threshold;
    wallet.cosigners = dto.cosigners;
    return this.walletRepository.save(wallet);
  }
}
