import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import { Asset } from './entities/asset.entity';
import { IndexAssetDto } from './dto/index-asset.dto';
import { QueryAssetDto } from './dto/query-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetsRepository: Repository<Asset>,
  ) {}

  /**
   * Idempotently records an asset. Re-indexing the same (code, issuer) updates
   * the existing row rather than creating duplicates.
   */
  async upsert(dto: IndexAssetDto): Promise<Asset> {
    const issuer = dto.issuer ?? null;
    const existing = await this.assetsRepository.findOne({
      where: { code: dto.code, issuer: issuer ?? IsNull() },
    });

    const asset =
      existing ??
      this.assetsRepository.create({ code: dto.code, issuer });

    asset.isNative = issuer === null;
    asset.domain = dto.domain ?? asset.domain;
    if (dto.isVerified !== undefined) {
      asset.isVerified = dto.isVerified;
    }
    asset.lastIndexedAt = new Date();

    return this.assetsRepository.save(asset);
  }

  async findAll(query: QueryAssetDto): Promise<PaginatedResultDto<Asset>> {
    const qb = this.assetsRepository
      .createQueryBuilder('asset')
      .orderBy('asset.code', 'ASC')
      .skip(query.skip)
      .take(query.limit);

    if (query.code) {
      qb.andWhere('asset.code = :code', { code: query.code });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string): Promise<Asset> {
    const asset = await this.assetsRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException(`Asset ${id} not found`);
    }
    return asset;
  }
}
