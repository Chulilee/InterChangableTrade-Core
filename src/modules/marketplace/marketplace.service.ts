import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResultDto } from '@app/common';
import { Listing, ListingStatus } from './entities/listing.entity';
import { Order, OrderStatus, OrderType, OrderSide } from './entities/order.entity';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { QueryListingDto } from './dto/query-listing.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(Listing)
    private readonly listingsRepository: Repository<Listing>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
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

  async findAll(query: QueryListingDto): Promise<PaginatedResultDto<Listing>> {
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
    return new PaginatedResultDto(data, total, query.page, query.limit);
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
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('Not your listing');
    }
    Object.assign(listing, dto);
    return this.listingsRepository.save(listing);
  }

  /**
   * Soft-cancels a listing. We keep the row (rather than deleting) so it stays
   * visible in a seller's history and any linked transactions remain intact.
   */
  async cancel(id: string, userId: string): Promise<Listing> {
    const listing = await this.findOne(id);
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
    listing.status = ListingStatus.CANCELLED;
    return this.listingsRepository.save(listing);
  }

  private assertOwnership(listing: Listing, userId: string): void {
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
  }

  /** Create a new order on a listing. */
  async createOrder(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    // Verify listing exists and is active
    const listing = await this.listingsRepository.findOne({
      where: { id: dto.listingId, status: ListingStatus.ACTIVE },
    });
    if (!listing) throw new NotFoundException('Listing not found or not active');

    // Validate price requirement by order type
    if (dto.orderType === OrderType.LIMIT && !dto.price) {
      throw new BadRequestException('Limit orders require a price');
    }
    if (dto.orderType === OrderType.STOP_LOSS && !dto.price) {
      throw new BadRequestException('Stop-loss orders require a price (stop price)');
    }

    const order = this.ordersRepository.create({
      ...dto,
      userId: buyerId,
      listingId: dto.listingId,
      status: OrderStatus.PENDING,
      filledAmount: '0',
    });
    return this.ordersRepository.save(order);
  }

  async findAllOrders(query: QueryOrderDto): Promise<PaginatedResultDto<Order>> {
    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.listing', 'listing')
      .orderBy('order.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.status) {
      qb.andWhere('order.status = :status', { status: query.status });
    }
    if (query.orderType) {
      qb.andWhere('order.orderType = :orderType', { orderType: query.orderType });
    }
    if (query.listingId) {
      qb.andWhere('order.listingId = :listingId', { listingId: query.listingId });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  async findOneOrder(id: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: ['user', 'listing'],
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async cancelOrder(id: string, userId: string): Promise<Order> {
    const order = await this.findOneOrder(id);
    if (order.userId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Only pending orders can be cancelled');
    }
    return this.ordersRepository.save({ ...order, status: OrderStatus.CANCELLED });
  }
}