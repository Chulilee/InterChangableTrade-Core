import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus, OrderType } from './entities/order.entity';
import { Listing } from './entities/listing.entity';
import { MarketplaceService } from './marketplace.service';
import { PriceOracleService } from '../liquidity-aggregator/services/price-oracle.service';

/**
 * Job payload for order monitoring checks.
 */
export interface OrderMonitorJobData {
  /** Optional single order to check. When omitted, all pending orders are scanned. */
  orderId?: string;
}

/**
 * Bull processor that monitors pending advanced orders (limit, stop-loss,
 * trailing-stop) against live market prices and transitions them through
 * their lifecycle (PENDING -> TRIGGERED -> FILLED/CANCELLED).
 *
 * The processor is triggered by the `order-monitoring` queue. On each run it
 * scans all pending non-market orders, looks up the current market price for
 * the order's listing asset pair, and triggers any order whose price condition
 * has been met.
 */
@Injectable()
@Processor('order-monitoring')
export class OrderMonitoringProcessor {
  private readonly logger = new Logger(OrderMonitoringProcessor.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Listing)
    private readonly listingRepository: Repository<Listing>,
    private readonly marketplaceService: MarketplaceService,
    private readonly priceOracleService: PriceOracleService,
  ) {}

  /**
   * Process a single order-monitoring job. Scans pending orders and triggers
   * those whose price conditions are satisfied by the current market price.
   */
  @Process('check-pending-orders')
  async checkPendingOrders(_job: Job<OrderMonitorJobData>): Promise<void> {
    const pendingOrders = await this.orderRepository.find({
      where: { status: OrderStatus.PENDING },
      relations: ['listing'],
    });

    if (pendingOrders.length === 0) {
      this.logger.debug('No pending orders to monitor');
      return;
    }

    this.logger.log(
      `Monitoring ${pendingOrders.length} pending order(s) for trigger conditions`,
    );

    // Group orders by listing so we fetch each asset price once.
    const ordersByListing = new Map<string, Order[]>();
    for (const order of pendingOrders) {
      if (order.orderType === OrderType.MARKET) continue;
      const listingId = order.listingId;
      const group = ordersByListing.get(listingId) ?? [];
      group.push(order);
      ordersByListing.set(listingId, group);
    }

    for (const [listingId, orders] of ordersByListing) {
      const listing = await this.listingRepository.findOne({
        where: { id: listingId },
      });
      if (!listing) {
        this.logger.warn(
          `Listing ${listingId} not found, skipping ${orders.length} order(s)`,
        );
        continue;
      }

      const currentPrice = await this.getCurrentPrice(listing);
      if (!currentPrice || currentPrice <= 0) {
        this.logger.warn(
          `No valid price for listing ${listingId}, skipping order evaluation`,
        );
        continue;
      }

      for (const order of orders) {
        const triggered = this.marketplaceService.evaluateOrderTrigger(
          order,
          currentPrice,
        );
        if (triggered) {
          await this.marketplaceService.triggerOrder(order.id);
          this.logger.log(
            `Order ${order.id} (${order.orderType}) triggered at price ${currentPrice}`,
          );
        }
      }
    }
  }

  /**
   * Resolve the current market price for a listing's asset pair using the
   * price oracle. Falls back to the listing's own price when no oracle data
   * is available.
   */
  private async getCurrentPrice(listing: Listing): Promise<number> {
    try {
      const aggregated = await this.priceOracleService.getAggregatedPrice(
        listing.assetCode,
        listing.assetIssuer ?? null,
        listing.priceAssetCode,
        null,
      );
      if (aggregated.poolCount > 0 && aggregated.weightedPrice > 0) {
        return aggregated.weightedPrice;
      }
    } catch {
      // Oracle unavailable — fall through to listing price.
    }

    // Fallback: use the listing price as the current market reference.
    return parseFloat(listing.price);
  }
}
