import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import { Listing, ListingStatus } from './entities/listing.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { QueryListingDto } from './dto/query-listing.dto';

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingsRepository: Repository<Listing>,
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const listing = this.listingsRepository.create({
      ...dto,
      assetIssuer: dto.assetIssuer ?? null,
      sellerId,
      status: ListingStatus.ACTIVE,
    });
    return this.listingsRepository.save(listing);
  }

  async findAll(
    query: QueryListingDto,
  ): Promise<PaginatedResultDto<Listing>> {
    const qb = this.listingsRepository
      .createQueryBuilder('listing')
      .leftJoinAndSelect('listing.seller', 'seller')
      .orderBy('listing.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.status) {
      qb.andWhere('listing.status = :status', { status: query.status });
    }
    if (query.assetCode) {
      qb.andWhere('listing.assetCode = :assetCode', {
        assetCode: query.assetCode,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page ?? 1, query.limit ?? 20);
  }

  async findOne(id: string): Promise<Listing> {
    const listing = await this.listingsRepository.findOne({ where: { id } });
    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }
    return listing;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    const listing = await this.findOne(id);
    this.assertOwnership(listing, userId);
    Object.assign(listing, dto);
    return this.listingsRepository.save(listing);
  }

  /**
   * Soft-cancels a listing. We keep the row (rather than deleting) so it stays
   * visible in a seller's history and any linked transactions remain intact.
   */
  async cancel(id: string, userId: string): Promise<Listing> {
    const listing = await this.findOne(id);
    this.assertOwnership(listing, userId);
    listing.status = ListingStatus.CANCELLED;
    return this.listingsRepository.save(listing);
  }

  private assertOwnership(listing: Listing, userId: string): void {
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
  }
}
