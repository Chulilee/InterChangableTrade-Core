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

  async upsert(dto: IndexAssetDto): Promise<Asset> {
    const issuer = dto.issuer ?? null;
    const existing = await this.assetsRepository.findOne({
      where: { code: dto.code, issuer: issuer ?? IsNull() },
    });

    const asset =
      existing ?? this.assetsRepository.create({ code: dto.code, issuer });

    asset.isNative = issuer === null;
    asset.domain = dto.domain ?? asset.domain;
    if (dto.isVerified !== undefined) {
      asset.isVerified = dto.isVerified;
    }
    asset.name = dto.name ?? asset.name;
    asset.description = dto.description ?? asset.description;
    asset.imageUrl = dto.imageUrl ?? asset.imageUrl;
    asset.status = dto.status ?? asset.status;
    if (dto.isTradeable !== undefined) {
      asset.isTradeable = dto.isTradeable;
    }
    asset.deprecationDate = dto.deprecationDate ?? asset.deprecationDate;
    if (dto.migratedTo) {
      const migratedToAsset = await this.assetsRepository.findOne({
        where: { id: dto.migratedTo },
      });
      if (migratedToAsset) {
        asset.migratedTo = migratedToAsset;
      }
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
    if (query.issuer) {
      qb.andWhere('asset.issuer = :issuer', { issuer: query.issuer });
    }
    if (query.name) {
      qb.andWhere('asset.name ILIKE :name', { name: `%${query.name}%` });
    }
    if (query.status) {
      qb.andWhere('asset.status = :status', { status: query.status });
    }
    if (query.isTradeable !== undefined) {
      qb.andWhere('asset.isTradeable = :isTradeable', {
        isTradeable: query.isTradeable,
      });
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
