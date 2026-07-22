import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const KEY_PREFIX = 'ict_';
const KEY_BYTES = 32; // 256-bit entropy
const BCRYPT_ROUNDS = 10;
const PREVIEW_LENGTH = 8; // tail chars shown in UI

/**
 * Manages API key lifecycle: creation, verification, listing, and revocation.
 *
 * The raw key is returned exactly once on creation and is never stored.
 * Only a bcrypt hash is persisted.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
  ) {}

  /**
   * Creates a new API key for the user.
   * @returns the created `ApiKey` entity plus the one-time `plainKey`.
   */
  async create(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const existing = await this.apiKeyRepo.findOne({
      where: { userId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `An API key named "${dto.name}" already exists`,
      );
    }

    const rawKey = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);
    const keyPreview = rawKey.slice(-PREVIEW_LENGTH);

    const apiKey = this.apiKeyRepo.create({
      userId,
      name: dto.name,
      keyHash,
      keyPreview,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    await this.apiKeyRepo.save(apiKey);
    return { apiKey, plainKey: rawKey };
  }

  /** Lists all API keys for a user (key hashes excluded). */
  async listForUser(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Validates a raw API key string.
   * @returns the matching `ApiKey` (with populated `user` relation) on success.
   */
  async validate(rawKey: string): Promise<ApiKey> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    // Load all active, non-expired keys to compare hashes.
    // In practice, production systems often add a fast-path lookup using a
    // deterministic prefix/lookup-token stored in plain text. For this
    // implementation we keep it simple with a full-table scan bounded by
    // `isActive` and index on userId.
    const candidates = await this.apiKeyRepo
      .createQueryBuilder('k')
      .addSelect('k.keyHash')
      .leftJoinAndSelect('k.user', 'user')
      .where('k.isActive = true')
      .andWhere('(k.expiresAt IS NULL OR k.expiresAt > NOW())')
      .getMany();

    for (const candidate of candidates) {
      const matches = await bcrypt.compare(rawKey, candidate.keyHash);
      if (matches) {
        // Update last-used timestamp asynchronously (best-effort).
        this.apiKeyRepo
          .update(candidate.id, { lastUsedAt: new Date() })
          .catch(() => undefined);
        return candidate;
      }
    }

    throw new UnauthorizedException('Invalid or expired API key');
  }

  /** Revokes (soft-deletes) a specific API key owned by the user. */
  async revoke(userId: string, keyId: string): Promise<void> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, userId } });
    if (!key) {
      throw new NotFoundException('API key not found');
    }
    key.isActive = false;
    await this.apiKeyRepo.save(key);
  }
}
