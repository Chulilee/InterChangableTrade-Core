import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LiquidityPool,
  PoolType,
  PoolStatus,
} from '../entities/liquidity-pool.entity';
import { PoolSnapshot } from '../entities/pool-snapshot.entity';
import { RegisterPoolDto, QueryPoolsDto } from '../dto/index';
import { PaginatedResultDto } from '@app/common';

/**
 * Maintains the registry of known liquidity pools, tracks TVL/volume/fee
 * changes, and takes periodic snapshots for historical analytics.
 */
@Injectable()
export class PoolRegistryService {
  private readonly logger = new Logger(PoolRegistryService.name);

  /** In-memory index: "CODE-A:CODE-B" → pool IDs for O(1) lookups. */
  private pairIndex = new Map<string, string[]>();

  constructor(
    @InjectRepository(LiquidityPool)
    private readonly poolRepository: Repository<LiquidityPool>,
    @InjectRepository(PoolSnapshot)
    private readonly snapshotRepository: Repository<PoolSnapshot>,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async register(dto: RegisterPoolDto): Promise<LiquidityPool> {
    const existing = await this.poolRepository.findOne({
      where: {
        assetCodeA: dto.assetCodeA,
        assetIssuerA: dto.assetIssuerA ?? undefined,
        assetCodeB: dto.assetCodeB,
        assetIssuerB: dto.assetIssuerB ?? undefined,
        type: dto.type,
      },
    });

    if (existing) {
      throw new BadRequestException(
        'A pool for this asset pair and type already exists',
      );
    }

    const pool = this.poolRepository.create({
      name: dto.name,
      type: dto.type,
      assetCodeA: dto.assetCodeA,
      assetIssuerA: dto.assetIssuerA ?? null,
      assetCodeB: dto.assetCodeB,
      assetIssuerB: dto.assetIssuerB ?? null,
      onChainAddress: dto.onChainAddress ?? null,
      feeRate: dto.feeRate?.toString() ?? '0',
      config: dto.config ?? null,
      status: PoolStatus.ACTIVE,
      tvl: '0',
      volume24h: '0',
      feeRevenue24h: '0',
    });

    const saved = await this.poolRepository.save(pool);
    this.rebuildPairIndex();
    this.logger.log(`Registered pool ${saved.id} (${saved.name})`);
    return saved;
  }

  async findAll(query: QueryPoolsDto): Promise<PaginatedResultDto<LiquidityPool>> {
    const qb = this.poolRepository
      .createQueryBuilder('pool')
      .orderBy('pool.tvl', 'DESC');

    if (query.type) qb.andWhere('pool.type = :type', { type: query.type });
    if (query.status)
      qb.andWhere('pool.status = :status', { status: query.status });
    if (query.assetCode) {
      qb.andWhere(
        '(pool.assetCodeA = :ac OR pool.assetCodeB = :ac)',
        { ac: query.assetCode },
      );
    }

    qb.skip((query.page! - 1) * query.limit!).take(query.limit!);
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page!, query.limit!);
  }

  async findById(id: string): Promise<LiquidityPool> {
    const pool = await this.poolRepository.findOne({ where: { id } });
    if (!pool) throw new NotFoundException(`Pool ${id} not found`);
    return pool;
  }

  async findActivePools(): Promise<LiquidityPool[]> {
    return this.poolRepository.find({ where: { status: PoolStatus.ACTIVE } });
  }

  async deactivate(id: string): Promise<LiquidityPool> {
    const pool = await this.findById(id);
    pool.status = PoolStatus.INACTIVE;
    await this.poolRepository.save(pool);
    this.rebuildPairIndex();
    return pool;
  }

  // ─── TVL / Volume refresh ────────────────────────────────────────────────

  async refreshPool(poolId: string, metrics: {
    tvl: string;
    volume24h: string;
    feeRevenue24h: string;
    feeRate: string;
    reserveA: string;
    reserveB: string;
    spotPrice: string;
  }): Promise<void> {
    const pool = await this.findById(poolId);

    pool.tvl = metrics.tvl;
    pool.volume24h = metrics.volume24h;
    pool.feeRevenue24h = metrics.feeRevenue24h;
    pool.feeRate = metrics.feeRate;
    pool.lastRefreshedAt = new Date();

    await this.poolRepository.save(pool);

    // Take a snapshot
    await this.snapshotRepository.save(
      this.snapshotRepository.create({
        poolId,
        tvl: metrics.tvl,
        volume24h: metrics.volume24h,
        feeRevenue24h: metrics.feeRevenue24h,
        reserveA: metrics.reserveA,
        reserveB: metrics.reserveB,
        spotPrice: metrics.spotPrice,
        feeRate: metrics.feeRate,
        snapshotAt: new Date(),
      }),
    );
  }

  async bulkUpdateMetrics(
    updates: Array<{
      poolId: string;
      tvl: string;
      volume24h: string;
      feeRevenue24h: string;
      feeRate: string;
      reserveA: string;
      reserveB: string;
      spotPrice: string;
    }>,
  ): Promise<void> {
    for (const u of updates) {
      await this.refreshPool(u.poolId, u);
    }
    this.logger.log(`Bulk-updated metrics for ${updates.length} pools`);
  }

  // ─── Pair index helpers ──────────────────────────────────────────────────

  /** Returns all active pools that include the given asset pair (in either direction). */
  async getPoolsForPair(
    assetCodeA: string,
    assetIssuerA: string | null,
    assetCodeB: string,
    assetIssuerB: string | null,
  ): Promise<LiquidityPool[]> {
    return this.poolRepository.find({
      where: [
        {
          assetCodeA,
          assetIssuerA: assetIssuerA ?? undefined,
          assetCodeB,
          assetIssuerB: assetIssuerB ?? undefined,
          status: PoolStatus.ACTIVE,
        },
        {
          assetCodeA: assetCodeB,
          assetIssuerA: assetIssuerB ?? undefined,
          assetCodeB: assetCodeA,
          assetIssuerB: assetIssuerA ?? undefined,
          status: PoolStatus.ACTIVE,
        },
      ],
    });
  }

  /** Get all assets that can be reached from the given asset via active pools. */
  async getReachableAssets(assetCode: string): Promise<string[]> {
    const pools = await this.poolRepository.find({
      where: [
        { assetCodeA: assetCode, status: PoolStatus.ACTIVE },
        { assetCodeB: assetCode, status: PoolStatus.ACTIVE },
      ],
    });

    const reachable = new Set<string>();
    for (const pool of pools) {
      if (pool.assetCodeA === assetCode) reachable.add(pool.assetCodeB);
      else reachable.add(pool.assetCodeA);
    }
    return Array.from(reachable);
  }

  // ─── Snapshots ───────────────────────────────────────────────────────────

  async getSnapshots(
    poolId: string,
    from: Date,
    to: Date,
  ): Promise<PoolSnapshot[]> {
    return this.snapshotRepository
      .createQueryBuilder('snap')
      .where('snap.poolId = :poolId', { poolId })
      .andWhere('snap.snapshotAt BETWEEN :from AND :to', { from, to })
      .orderBy('snap.snapshotAt', 'ASC')
      .getMany();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private rebuildPairIndex(): void {
    this.pairIndex.clear();
  }
}
