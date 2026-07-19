import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Order, OrderStatus, OrderSide, OrderType } from './entities/order.entity';
import { Trade } from './entities/trade.entity';
import { AuditTrail, AuditActionType } from './entities/audit-trail.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { StellarService } from '../stellar/stellar.service';
import { PaginatedResultDto } from '@app/common';

@Injectable()
export class TradingEngineService {
  private readonly logger = new Logger(TradingEngineService.name);
  private orderBooks: Map<string, { bids: Order[]; asks: Order[] }> = new Map();

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(AuditTrail)
    private readonly auditTrailRepository: Repository<AuditTrail>,
    private readonly stellarService: StellarService,
  ) {
    this.initializeOrderBooks();
  }

  private async initializeOrderBooks() {
    const openOrders = await this.orderRepository.find({
      where: { status: In([OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]) }
    });
    
    openOrders.forEach(order => {
      this.addToOrderBook(order);
    });
    
    this.logger.log(`Initialized order books with ${openOrders.length} open orders`);
  }

  private getAssetKey(assetCode: string, assetIssuer?: string | null): string {
    return assetIssuer ? `${assetCode}-${assetIssuer}` : assetCode;
  }

  private addToOrderBook(order: Order) {
    const assetKey = this.getAssetKey(order.assetCode, order.assetIssuer);
    if (!this.orderBooks.has(assetKey)) {
      this.orderBooks.set(assetKey, { bids: [], asks: [] });
    }
    
    const orderBook = this.orderBooks.get(assetKey)!;
    if (order.side === OrderSide.BUY) {
      orderBook.bids.push(order);
      // Sort bids in descending order of price (highest first)
      orderBook.bids.sort((a, b) => parseFloat(b.price!) - parseFloat(a.price!));
    } else {
      orderBook.asks.push(order);
      // Sort asks in ascending order of price (lowest first)
      orderBook.asks.sort((a, b) => parseFloat(a.price!) - parseFloat(b.price!));
    }
  }

  private removeFromOrderBook(order: Order) {
    const assetKey = this.getAssetKey(order.assetCode, order.assetIssuer);
    const orderBook = this.orderBooks.get(assetKey);
    if (!orderBook) return;

    if (order.side === OrderSide.BUY) {
      orderBook.bids = orderBook.bids.filter(o => o.id !== order.id);
    } else {
      orderBook.asks = orderBook.asks.filter(o => o.id !== order.id);
    }
  }

  private async createAuditTrail(
    entityId: string,
    entityType: string,
    action: AuditActionType,
    actorId: string,
    previousState: Record<string, any>,
    newState: Record<string, any>,
    metadata?: Record<string, any>
  ) {
    const auditTrail = this.auditTrailRepository.create({
      entityId,
      entityType,
      action,
      actorId,
      previousState,
      newState,
      metadata
    });
    await this.auditTrailRepository.save(auditTrail);
  }

  private matchOrder(newOrder: Order): Trade[] {
    const startTime = Date.now();
    const trades: Trade[] = [];
    const assetKey = this.getAssetKey(newOrder.assetCode, newOrder.assetIssuer);
    const orderBook = this.orderBooks.get(assetKey);
    
    if (!orderBook) return trades;

    let remainingQuantity = parseFloat(newOrder.filledQuantity) > 0 
      ? parseFloat(newOrder.quantity) - parseFloat(newOrder.filledQuantity)
      : parseFloat(newOrder.quantity);

    const oppositeOrders = newOrder.side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
    
    while (remainingQuantity > 0 && oppositeOrders.length > 0) {
      const bestOpposite = oppositeOrders[0];
      
      // Check if prices match for limit orders
      if (newOrder.type === OrderType.LIMIT) {
        if (!newOrder.price || !bestOpposite.price) break;
        const newOrderPrice = parseFloat(newOrder.price);
        const bestPrice = parseFloat(bestOpposite.price);
        
        if (newOrder.side === OrderSide.BUY && newOrderPrice < bestPrice) break;
        if (newOrder.side === OrderSide.SELL && newOrderPrice > bestPrice) break;
      }

      // Calculate trade quantity
      const bestRemaining = parseFloat(bestOpposite.quantity) - parseFloat(bestOpposite.filledQuantity);
      const tradeQuantity = Math.min(remainingQuantity, bestRemaining);
      
      // Create trade record
      const trade = this.tradeRepository.create({
        makerOrderId: newOrder.side === OrderSide.BUY ? bestOpposite.id : newOrder.id,
        takerOrderId: newOrder.side === OrderSide.BUY ? newOrder.id : bestOpposite.id,
        makerUserId: newOrder.side === OrderSide.BUY ? bestOpposite.userId : newOrder.userId,
        takerUserId: newOrder.side === OrderSide.BUY ? newOrder.userId : bestOpposite.userId,
        assetCode: newOrder.assetCode,
        assetIssuer: newOrder.assetIssuer,
        quantity: tradeQuantity.toString(),
        price: bestOpposite.price!,
        settled: false
      });
      
      trades.push(trade);

      // Update filled quantities
      const newFilled = parseFloat(newOrder.filledQuantity) + tradeQuantity;
      newOrder.filledQuantity = newFilled.toString();
      const bestFilled = parseFloat(bestOpposite.filledQuantity) + tradeQuantity;
      bestOpposite.filledQuantity = bestFilled.toString();

      // Update order statuses
      if (parseFloat(newOrder.filledQuantity) >= parseFloat(newOrder.quantity)) {
        newOrder.status = OrderStatus.FILLED;
      } else if (parseFloat(newOrder.filledQuantity) > 0) {
        newOrder.status = OrderStatus.PARTIALLY_FILLED;
      }

      if (parseFloat(bestOpposite.filledQuantity) >= parseFloat(bestOpposite.quantity)) {
        bestOpposite.status = OrderStatus.FILLED;
        oppositeOrders.shift(); // Remove fully filled order from book
      }

      remainingQuantity -= tradeQuantity;
    }

    const executionTime = Date.now() - startTime;
    this.logger.log(`Order matching executed in ${executionTime}ms, created ${trades.length} trades`);
    
    if (executionTime > 500) {
      this.logger.warn(`Order matching exceeded latency target: ${executionTime}ms`);
    }

    return trades;
  }

  async createOrder(userId: string, createOrderDto: CreateOrderDto): Promise<Order> {
    const startTime = Date.now();
    
    // Validate order
    if (createOrderDto.type === OrderType.LIMIT && !createOrderDto.price) {
      throw new BadRequestException('Limit orders must specify a price');
    }
    
    if (createOrderDto.expiresAt && new Date(createOrderDto.expiresAt) < new Date()) {
      throw new BadRequestException('Expiration date must be in the future');
    }

    // Create order
    const order = this.orderRepository.create({
      userId,
      ...createOrderDto,
      status: OrderStatus.PENDING,
      filledQuantity: '0'
    });

    const previousState = { ...order };
    order.status = OrderStatus.OPEN;
    await this.orderRepository.save(order);
    
    // Record audit trail
    await this.createAuditTrail(
      order.id,
      'order',
      AuditActionType.ORDER_CREATED,
      userId,
      previousState,
      order
    );

    // Match order
    const trades = this.matchOrder(order);
    
    // If order is still open, add to order book
    if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
      this.addToOrderBook(order);
    }

    // Save all trades and update orders
    for (const trade of trades) {
      await this.tradeRepository.save(trade);
    }
    await this.orderRepository.save(order);

    const validationTime = Date.now() - startTime;
    this.logger.log(`Order ${order.id} created and validated in ${validationTime}ms`);
    
    if (validationTime > 100) {
      this.logger.warn(`Order validation exceeded latency target: ${validationTime}ms`);
    }

    return order;
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new BadRequestException('You can only cancel your own orders');
    }

    if (![OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED].includes(order.status)) {
      throw new BadRequestException('Cannot cancel order that is not open');
    }

    const previousState = { ...order };
    this.removeFromOrderBook(order);
    order.status = OrderStatus.CANCELLED;
    
    await this.orderRepository.save(order);
    
    await this.createAuditTrail(
      order.id,
      'order',
      AuditActionType.ORDER_CANCELLED,
      userId,
      previousState,
      order
    );

    return order;
  }

  async getOrderById(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async getOrders(queryDto: QueryOrderDto): Promise<PaginatedResultDto<Order>> {
    const { page = 1, limit = 10, status, side, assetCode, userId, fromDate, toDate } = queryDto;
    const query = this.orderRepository.createQueryBuilder('order');

    if (status) query.andWhere('order.status = :status', { status });
    if (side) query.andWhere('order.side = :side', { side });
    if (assetCode) query.andWhere('order.assetCode = :assetCode', { assetCode });
    if (userId) query.andWhere('order.userId = :userId', { userId });
    if (fromDate) query.andWhere('order.createdAt >= :fromDate', { fromDate });
    if (toDate) query.andWhere('order.createdAt <= :toDate', { toDate });

    query.skip((page - 1) * limit).take(limit);
    const [orders, total] = await query.getManyAndCount();

    return new PaginatedResultDto(orders, total, page, limit);
  }

  async getTrades(queryDto: any): Promise<PaginatedResultDto<Trade>> {
    const { page = 1, limit = 10, assetCode, userId } = queryDto;
    const query = this.tradeRepository.createQueryBuilder('trade');

    if (assetCode) query.andWhere('trade.assetCode = :assetCode', { assetCode });
    if (userId) query.andWhere('trade.makerUserId = :userId OR trade.takerUserId = :userId', { userId });

    query.skip((page - 1) * limit).take(limit);
    const [trades, total] = await query.getManyAndCount();

    return new PaginatedResultDto(trades, total, page, limit);
  }

  async settleTrade(tradeId: string): Promise<Trade> {
    const trade = await this.tradeRepository.findOne({ where: { id: tradeId } });
    if (!trade) {
      throw new NotFoundException('Trade not found');
    }

    if (trade.settled) {
      throw new BadRequestException('Trade already settled');
    }

    // Execute settlement on Stellar blockchain
    const txHash = await this.stellarService.executeSettlement({
      fromAccount: trade.takerUserId, // Simplified - would be actual Stellar accounts
      toAccount: trade.makerUserId,
      assetCode: trade.assetCode,
      assetIssuer: trade.assetIssuer,
      amount: trade.quantity,
      price: trade.price
    });

    const previousState = { ...trade };
    trade.stellarTxHash = txHash;
    trade.settled = true;
    trade.settledAt = new Date();
    
    await this.tradeRepository.save(trade);
    
    await this.createAuditTrail(
      trade.id,
      'trade',
      AuditActionType.TRADE_SETTLED,
      trade.makerUserId, // System or settlement actor
      previousState,
      trade
    );

    return trade;
  }

  // Cleanup expired orders - would be called by a cron job
  async cleanupExpiredOrders() {
    const expiredOrders = await this.orderRepository.find({
      where: {
        status: In([OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]),
        expiresAt: LessThan(new Date())
      }
    });

    for (const order of expiredOrders) {
      const previousState = { ...order };
      this.removeFromOrderBook(order);
      order.status = OrderStatus.EXPIRED;
      await this.orderRepository.save(order);
      
      await this.createAuditTrail(
        order.id,
        'order',
        AuditActionType.ORDER_UPDATED,
        order.userId,
        previousState,
        order,
        { reason: 'Order expired' }
      );
    }

    this.logger.log(`Cleaned up ${expiredOrders.length} expired orders`);
  }
}