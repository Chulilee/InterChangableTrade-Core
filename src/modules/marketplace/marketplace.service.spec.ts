import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { Order, OrderSide, OrderStatus, OrderType } from './entities/order.entity';
import { Listing, ListingStatus } from './entities/listing.entity';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount?: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createListingMock(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    title: 'Test Listing',
    assetCode: 'XLM',
    assetIssuer: null,
    amount: '100.0000000',
    price: '1.0000000',
    priceAssetCode: 'XLM',
    status: ListingStatus.ACTIVE,
    sellerId: 'seller-1',
    ...overrides,
  } as unknown as Listing;
}

function createOrderMock(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    userId: 'buyer-1',
    listingId: 'listing-1',
    orderType: OrderType.LIMIT,
    side: OrderSide.BUY,
    amount: '10.0000000',
    price: '100.0000000',
    stopPrice: null,
    stopPercentage: null,
    status: OrderStatus.PENDING,
    filledAmount: '0',
    triggeredAt: null,
    executedAt: null,
    ...overrides,
  } as unknown as Order;
}

describe('MarketplaceService — advanced order types', () => {
  let service: MarketplaceService;
  let listingsRepo: RepoMock;
  let ordersRepo: RepoMock;

  beforeEach(() => {
    listingsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    ordersRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    service = new MarketplaceService(
      listingsRepo as any,
      ordersRepo as any,
    );
  });

  // -------------------------------------------------------
  //  Order creation validation
  // -------------------------------------------------------
  describe('createOrder validation', () => {
    it('rejects a limit order without a price', async () => {
      listingsRepo.findOne.mockResolvedValue(createListingMock());
      await expect(
        service.createOrder('buyer-1', {
          listingId: 'listing-1',
          side: OrderSide.BUY,
          orderType: OrderType.LIMIT,
          amount: '10',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a stop-loss order without a stop price', async () => {
      listingsRepo.findOne.mockResolvedValue(createListingMock());
      await expect(
        service.createOrder('buyer-1', {
          listingId: 'listing-1',
          side: OrderSide.SELL,
          orderType: OrderType.STOP_LOSS,
          amount: '10',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects orders on a listing that is not active', async () => {
      listingsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createOrder('buyer-1', {
          listingId: 'listing-404',
          side: OrderSide.BUY,
          orderType: OrderType.MARKET,
          amount: '10',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a market order in PENDING state with zero fill', async () => {
      listingsRepo.findOne.mockResolvedValue(createListingMock());
      ordersRepo.create.mockImplementation((v) => ({ id: 'order-9', ...v }));
      ordersRepo.save.mockImplementation(async (v) => v);

      const order = await service.createOrder('buyer-1', {
        listingId: 'listing-1',
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
        amount: '10',
      } as any);

      expect(order.status).toBe(OrderStatus.PENDING);
      expect(order.filledAmount).toBe('0');
      expect(order.userId).toBe('buyer-1');
    });
  });

  // -------------------------------------------------------
  //  evaluateOrderTrigger
  // -------------------------------------------------------
  describe('evaluateOrderTrigger', () => {
    it('LIMIT BUY triggers when market price <= limit price', () => {
      const order = createOrderMock({
        orderType: OrderType.LIMIT,
        side: OrderSide.BUY,
        price: '100',
      });
      expect(service.evaluateOrderTrigger(order, 99)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 100)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 101)).toBe(false);
    });

    it('LIMIT SELL triggers when market price >= limit price', () => {
      const order = createOrderMock({
        orderType: OrderType.LIMIT,
        side: OrderSide.SELL,
        price: '100',
      });
      expect(service.evaluateOrderTrigger(order, 101)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 100)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 99)).toBe(false);
    });

    it('STOP_LOSS SELL triggers when market price <= stop price', () => {
      const order = createOrderMock({
        orderType: OrderType.STOP_LOSS,
        side: OrderSide.SELL,
        price: null,
        stopPrice: '90',
      });
      expect(service.evaluateOrderTrigger(order, 89)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 90)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 91)).toBe(false);
    });

    it('STOP_LOSS BUY triggers when market price >= stop price', () => {
      const order = createOrderMock({
        orderType: OrderType.STOP_LOSS,
        side: OrderSide.BUY,
        price: null,
        stopPrice: '110',
      });
      expect(service.evaluateOrderTrigger(order, 111)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 110)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 109)).toBe(false);
    });

    it('TRAILING_STOP SELL triggers when market price <= trailing stop', () => {
      const order = createOrderMock({
        orderType: OrderType.TRAILING_STOP,
        side: OrderSide.SELL,
        price: null,
        stopPrice: '85',
      });
      expect(service.evaluateOrderTrigger(order, 84)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 86)).toBe(false);
    });

    it('TRAILING_STOP BUY triggers when market price >= trailing stop', () => {
      const order = createOrderMock({
        orderType: OrderType.TRAILING_STOP,
        side: OrderSide.BUY,
        price: null,
        stopPrice: '105',
      });
      expect(service.evaluateOrderTrigger(order, 106)).toBe(true);
      expect(service.evaluateOrderTrigger(order, 104)).toBe(false);
    });

    it('MARKET orders never trigger via monitoring', () => {
      const order = createOrderMock({ orderType: OrderType.MARKET });
      expect(service.evaluateOrderTrigger(order, 0)).toBe(false);
      expect(service.evaluateOrderTrigger(order, 99999)).toBe(false);
    });

    it('returns false when the effective trigger price is missing or invalid', () => {
      expect(
        service.evaluateOrderTrigger(
          createOrderMock({ orderType: OrderType.LIMIT, price: null }),
          100,
        ),
      ).toBe(false);
      expect(
        service.evaluateOrderTrigger(
          createOrderMock({ orderType: OrderType.STOP_LOSS, stopPrice: null }),
          100,
        ),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------
  //  State machine transitions
  // -------------------------------------------------------
  describe('triggerOrder (PENDING -> TRIGGERED)', () => {
    it('transitions a pending order to TRIGGERED and stamps triggeredAt', async () => {
      const order = createOrderMock({ status: OrderStatus.PENDING });
      ordersRepo.findOne.mockResolvedValue(order);
      ordersRepo.save.mockImplementation(async (v) => v);

      const result = await service.triggerOrder('order-1');

      expect(result.status).toBe(OrderStatus.TRIGGERED);
      expect(result.triggeredAt).toBeInstanceOf(Date);
      expect(ordersRepo.save).toHaveBeenCalledWith(order);
    });

    it('rejects triggering a non-pending order', async () => {
      const order = createOrderMock({ status: OrderStatus.FILLED });
      ordersRepo.findOne.mockResolvedValue(order);

      await expect(service.triggerOrder('order-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(ordersRepo.save).not.toHaveBeenCalled();
    });

    it('rejects triggering unknown order', async () => {
      ordersRepo.findOne.mockResolvedValue(null);
      await expect(service.triggerOrder('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelOrder (PENDING -> CANCELLED)', () => {
    it('transitions a pending order to CANCELLED', async () => {
      const order = createOrderMock({ status: OrderStatus.PENDING, userId: 'buyer-1' });
      ordersRepo.findOne.mockResolvedValue(order);
      ordersRepo.save.mockImplementation(async (v) => v);

      const result = await service.cancelOrder('order-1', 'buyer-1');
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('rejects cancelling a triggered order', async () => {
      ordersRepo.findOne.mockResolvedValue(
        createOrderMock({ status: OrderStatus.TRIGGERED, userId: 'buyer-1' }),
      );
      await expect(service.cancelOrder('order-1', 'buyer-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a cancel from a non-owner', async () => {
      ordersRepo.findOne.mockResolvedValue(
        createOrderMock({ status: OrderStatus.PENDING, userId: 'buyer-1' }),
      );
      await expect(service.cancelOrder('order-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('monitorAndTriggerOrders', () => {
    it('triggers only the orders whose price condition is met', async () => {
      const waiting = createOrderMock({
        id: 'order-wait',
        orderType: OrderType.LIMIT,
        side: OrderSide.BUY,
        price: '100',
        status: OrderStatus.PENDING,
      });
      const ready = createOrderMock({
        id: 'order-ready',
        orderType: OrderType.LIMIT,
        side: OrderSide.BUY,
        price: '120',
        status: OrderStatus.PENDING,
      });
      const market = createOrderMock({
        id: 'order-market',
        orderType: OrderType.MARKET,
        status: OrderStatus.PENDING,
      });
      ordersRepo.find.mockResolvedValue([waiting, ready, market]);
      ordersRepo.findOne.mockImplementation(async (opts?: any) => {
        const id = opts?.where?.id;
        return [waiting, ready, market].find((o) => o.id === id) ?? null;
      });
      ordersRepo.save.mockImplementation(async (v) => v);

      const triggered = await service.monitorAndTriggerOrders(110);

      expect(triggered.map((o) => o.id)).toEqual(['order-ready']);
      expect(ready.status).toBe(OrderStatus.TRIGGERED);
      expect(waiting.status).toBe(OrderStatus.PENDING);
      expect(market.status).toBe(OrderStatus.PENDING);
    });

    it('returns an empty array when nothing is pending', async () => {
      ordersRepo.find.mockResolvedValue([]);
      const triggered = await service.monitorAndTriggerOrders(110);
      expect(triggered).toEqual([]);
    });
  });
});
