import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import { PaginatedResultDto, PaginationQueryDto } from '@app/common';
import { StellarService } from '../stellar/stellar.service';
import { Wallet, WalletStatus } from './entities/wallet.entity';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { MultisigConfigDto } from './dto/multisig-config.dto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

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
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
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
   */
  async signTransaction(
    id: string,
    userId: string,
    dto: SignTransactionDto,
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

    const secretKey = this.decrypt(wallet.encryptedSecretKey);
    const keypair = Keypair.fromSecret(secretKey);

    const transaction = TransactionBuilder.fromXDR(
      dto.unsignedXdr,
      this.configService.get<string>('stellar.networkPassphrase') ??
        'Test SDF Network ; September 2015',
    );

    transaction.sign(keypair);
    const signedXdr = transaction.toEnvelope().toXDR('base64');

    this.logger.log(`Transaction signed by wallet ${id}`);
    return { signedXdr };
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
