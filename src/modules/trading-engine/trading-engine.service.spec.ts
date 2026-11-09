import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TradingEngineService,
} from './trading-engine.service';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from './entities/order.entity';
import { Trade } from './entities/trade.entity';
import { AuditActionType, AuditTrail } from './entities/audit-trail.entity';
import { StellarService } from '../stellar/stellar.service';

/**
 * Unit tests for the maker-fill persistence fix (issue #86).
 *
 * Uses plain in-memory fakes for the TypeORM repositories (house style for
 * unit tests) so the re-initialization flow — the restart simulation — runs
 * entirely in-process: a second service instance over the same fakes sees
 * exactly what a restarted process would see from the database.
 */

const ASSET = 'XLM';

class FakeStore {
  orders: Order[] = [];
  trades: Trade[] = [];
  audits: AuditTrail[] = [];
}

function createFakeOrderRepo(store: FakeStore) {
  let seq = 0;
  return {
    create: jest.fn((data: Partial<Order>) => ({
      ...data,
      id: data.id ?? `order-${++seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    save: jest.fn(async (input: any) => {
      const arr = Array.isArray(input) ? input : [input];
      const out = arr.map((o) => {
        const idx = store.orders.findIndex((r) => r.id === o.id);
        if (idx >= 0) {
          store.orders[idx] = { ...store.orders[idx], ...o };
          return store.orders[idx];
        }
        store.orders.push({ ...o });
        return o;
      });
      return Array.isArray(input) ? out : out[0];
    }),
    find: jest.fn(async () =>
      store.orders.filter(
        (o) =>
          o.status === OrderStatus.OPEN ||
          o.status === OrderStatus.PARTIALLY_FILLED,
      ),
    ),
    findOne: jest.fn(async ({ where: { id } }: any) =>
      store.orders.find((o) => o.id === id) ?? null,
    ),
  };
}

function createFakeTradeRepo(store: FakeStore) {
  let seq = 0;
  return {
    create: jest.fn((data: Partial<Trade>) => ({
      ...data,
      id: data.id ?? `trade-${++seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    save: jest.fn(async (input: any) => {
      const arr = Array.isArray(input) ? input : [input];
      const out = arr.map((t) => {
        const idx = store.trades.findIndex((r) => r.id === t.id);
        if (idx >= 0) {
          store.trades[idx] = { ...store.trades[idx], ...t };
          return store.trades[idx];
        }
        store.trades.push({ ...t });
        return t;
      });
      return Array.isArray(input) ? out : out[0];
    }),
  };
}

function createFakeAuditRepo(store: FakeStore) {
  let seq = 0;
  return {
    create: jest.fn((data: Partial<AuditTrail>) => ({
      ...data,
      id: data.id ?? `audit-${++seq}`,
    })),
    save: jest.fn(async (input: any) => {
      const arr = Array.isArray(input) ? input : [input];
      const out = arr.map((a) => {
        // Round out the entity so later assertions can rely on ids.
        const persisted = { ...a };
        store.audits.push(persisted);
        return persisted;
      });
      return Array.isArray(input) ? out : out[0];
    }),
  };
}

async function buildService(
  store: FakeStore,
  overrides: { dataSource?: unknown; orderRepo?: unknown; tradeRepo?: unknown } = {},
): Promise<{
  service: TradingEngineService;
  dataSource: unknown;
  stellar: { executeSettlement: jest.Mock };
}> {
  const orderRepo = (overrides.orderRepo ?? createFakeOrderRepo(store)) as any;
  const tradeRepo = (overrides.tradeRepo ?? createFakeTradeRepo(store)) as any;
  const auditRepo = createFakeAuditRepo(store);
  const stellar = { executeSettlement: jest.fn(async () => 'tx-hash') };
  const manager = {
    getRepository: (target: unknown) =>
      target === Order ? orderRepo : target === Trade ? tradeRepo : auditRepo,
  };
  const dataSource = (overrides.dataSource ?? {
    transaction: jest.fn(async (cb: (m: any) => Promise<unknown>) => cb(manager)),
  }) as unknown;

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      TradingEngineService,
      { provide: getRepositoryToken(Order), useValue: orderRepo },
      { provide: getRepositoryToken(Trade), useValue: tradeRepo },
      { provide: getRepositoryToken(AuditTrail), useValue: auditRepo },
      { provide: StellarService, useValue: stellar },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();

  return {
    service: moduleRef.get(TradingEngineService),
    dataSource,
    stellar,
  };
}

describe('TradingEngineService maker-fill persistence (issue #86)', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  it('persists a fully filled maker with filledQuantity and status FILLED', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);

    const taker = await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '10',
      assetCode: ASSET,
    } as any);

    expect(taker.status).toBe(OrderStatus.FILLED);

    const maker = store.orders.find((o) => o.userId === 'maker');
    expect(maker?.filledQuantity).toBe('10');
    expect(maker?.status).toBe(OrderStatus.FILLED);
  });

  it('persists a partially filled maker with correct filledQuantity', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);

    const taker = await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '4',
      assetCode: ASSET,
    } as any);

    expect(taker.status).toBe(OrderStatus.FILLED);

    const maker = store.orders.find((o) => o.userId === 'maker');
    expect(maker?.filledQuantity).toBe('4');
    expect(maker?.status).toBe(OrderStatus.PARTIALLY_FILLED);
  });

  it('does not re-match the maker after a restart and book re-initialization', async () => {
    const first = await buildService(store);

    await first.service.createOrder('maker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);
    await first.service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '10',
      assetCode: ASSET,
    } as any);

    // Simulate a process restart: a fresh service instance over the same
    // store reloads the order books from the repository.
    const second = await buildService(store);
    await new Promise((resolve) => setImmediate(resolve));

    const taker2 = await second.service.createOrder('taker2', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '5',
      assetCode: ASSET,
    } as any);

    // The stale maker must not be re-matched: the new taker stays open.
    expect(taker2.status).toBe(OrderStatus.OPEN);
    expect(taker2.filledQuantity).toBe('0');
    expect(store.trades.filter((t) => t.takerUserId === 'taker2')).toHaveLength(0);
  });

  it('writes an AuditActionType.TRADE_EXECUTED row per executed trade', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '6',
      price: '100',
      assetCode: ASSET,
    } as any);
    await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '6',
      assetCode: ASSET,
    } as any);

    const executed = store.audits.filter((a) => a.action === AuditActionType.TRADE_EXECUTED);
    expect(executed).toHaveLength(1);
    expect(executed[0].entityType).toBe('trade');
    expect(executed[0].actorId).toBe('taker');
    expect(executed[0].metadata).toMatchObject({
      takerOrderId: expect.any(String),
      makerOrderId: expect.any(String),
    });
  });

  it('records ORDER_CREATED with a snapshot taken before matching', async () => {
    const { service } = await buildService(store);

    const created = await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: '3',
      assetCode: ASSET,
    } as any);

    const createdAudits = store.audits.filter(
      (a) => a.action === AuditActionType.ORDER_CREATED,
    );
    expect(createdAudits).toHaveLength(1);
    // Snapshot taken before matching: it still shows status open, even
    // though the returned order is now filled.
    expect(createdAudits[0].newState).toMatchObject({ status: OrderStatus.OPEN });
    expect(createdAudits[0].previousState).toMatchObject({ status: OrderStatus.PENDING });
    expect(created.status).toBe(OrderStatus.OPEN); // no opposite book → stays open
  });

  it('rejects the order without leaving the taker in the book when persistence fails', async () => {
    const orderRepo = createFakeOrderRepo(store);
    const tradeRepo = createFakeTradeRepo(store);
    tradeRepo.save.mockRejectedValueOnce(new Error('db gone'));

    const { service } = await buildService(store, { orderRepo, tradeRepo });

    // Seed a resting maker directly in the book by creating one first.
    await service.createOrder('maker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);

    await expect(
      service.createOrder('taker', {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: '10',
        assetCode: ASSET,
      } as any),
    ).rejects.toThrow('db gone');

    // The taker must not linger in the in-memory book after a failed commit.
    const books: any = (service as any).orderBooks;
    for (const book of books.values()) {
      expect(book.bids.map((o: Order) => o.userId)).not.toContain('taker');
    }

    // No TRADE_EXECUTED audit rows: the transaction failed before audits.
    expect(
      store.audits.some((a) => a.action === AuditActionType.TRADE_EXECUTED),
    ).toBe(false);
  });
});

describe('TradingEngineService matching, book and cancellation (issue #96)', () => {
  let store: FakeStore;

  const bookFor = (service: TradingEngineService) =>
    (service as any).orderBooks.get(ASSET) as
      | { bids: Order[]; asks: Order[] }
      | undefined;

  const limitSell = (quantity: string, price: string) =>
    ({
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity,
      price,
      assetCode: ASSET,
    } as any);

  const marketBuy = (quantity: string) =>
    ({
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity,
      assetCode: ASSET,
    } as any);

  beforeEach(() => {
    store = new FakeStore();
  });

  it('matches the cheapest ask first for a market buy (price priority)', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker-expensive', limitSell('10', '101'));
    const cheap = await service.createOrder(
      'maker-cheap',
      limitSell('10', '100'),
    );

    const taker = await service.createOrder('taker', marketBuy('2'));

    const fill = store.trades.find((t) => t.takerOrderId === taker.id)!;
    expect(fill.price).toBe('100');
    expect(fill.makerOrderId).toBe(cheap.id);
  });

  it('matches the highest bid first for a market sell (price priority)', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker-low', {
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '99',
      assetCode: ASSET,
    } as any);
    const high = await service.createOrder('maker-high', {
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);

    const taker = await service.createOrder('taker', {
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity: '2',
      assetCode: ASSET,
    } as any);

    const fill = store.trades.find((t) => t.takerOrderId === taker.id)!;
    expect(fill.price).toBe('100');
    expect(fill.makerOrderId).toBe(high.id);
  });

  it('matches equally-priced makers in time order (time priority)', async () => {
    const { service } = await buildService(store);

    const first = await service.createOrder(
      'maker-1',
      limitSell('10', '100'),
    );
    await service.createOrder('maker-2', limitSell('10', '100'));

    const taker = await service.createOrder('taker', marketBuy('4'));

    const fill = store.trades.find((t) => t.takerOrderId === taker.id)!;
    expect(fill.makerOrderId).toBe(first.id);
  });

  it('partially fills across multiple makers and rests the remainder on the book', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker-a', limitSell('4', '100'));
    await service.createOrder('maker-b', limitSell('4', '101'));

    const taker = await service.createOrder('taker', marketBuy('10'));

    expect(taker.status).toBe(OrderStatus.PARTIALLY_FILLED);
    expect(taker.filledQuantity).toBe('8');

    const fills = store.trades
      .filter((t) => t.takerOrderId === taker.id)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    expect(fills).toHaveLength(2);
    expect(fills.map((t) => t.price)).toEqual(['100', '101']);
    expect(fills.map((t) => t.quantity)).toEqual(['4', '4']);

    // Both makers fully consumed and removed from the ask side.
    const book = bookFor(service);
    expect(book?.asks).toHaveLength(0);

    // Remainder of the taker rests on the bid side.
    const resting = book?.bids.find((o) => o.id === taker.id);
    expect(resting).toBeDefined();
    expect(resting?.filledQuantity).toBe('8');
  });

  it('does not match a limit buy priced below the best ask', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', limitSell('10', '100'));

    const taker = await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '5',
      price: '99',
      assetCode: ASSET,
    } as any);

    expect(taker.status).toBe(OrderStatus.OPEN);
    expect(store.trades).toHaveLength(0);

    const book = bookFor(service);
    expect(book?.bids.map((o) => o.id)).toContain(taker.id);
    expect(book?.asks.map((o) => o.userId)).toContain('maker');
  });

  it('does not match a limit sell priced above the best bid', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', {
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '10',
      price: '100',
      assetCode: ASSET,
    } as any);

    const taker = await service.createOrder('taker', {
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity: '5',
      price: '101',
      assetCode: ASSET,
    } as any);

    expect(taker.status).toBe(OrderStatus.OPEN);
    expect(store.trades).toHaveLength(0);

    const book = bookFor(service);
    expect(book?.asks.map((o) => o.id)).toContain(taker.id);
    expect(book?.bids.map((o) => o.userId)).toContain('maker');
  });

  it('matches at the maker price when prices cross (not the taker limit)', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', limitSell('10', '100'));

    const taker = await service.createOrder('taker', {
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '2',
      price: '105',
      assetCode: ASSET,
    } as any);

    const fill = store.trades.find((t) => t.takerOrderId === taker.id)!;
    expect(fill.price).toBe('100');
  });

  it('throws ForbiddenException when cancelling another user’s order', async () => {
    const { service } = await buildService(store);

    const order = await service.createOrder(
      'owner',
      limitSell('10', '100'),
    );

    await expect(
      service.cancelOrder(order.id, 'attacker'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The order must remain open and in the book.
    expect(store.orders.find((o) => o.id === order.id)?.status).toBe(
      OrderStatus.OPEN,
    );
    expect(bookFor(service)?.asks.map((o) => o.id)).toContain(order.id);
  });

  it('cancels own open order, removes it from the book and audits it', async () => {
    const { service } = await buildService(store);

    const order = await service.createOrder(
      'owner',
      limitSell('10', '100'),
    );

    const cancelled = await service.cancelOrder(order.id, 'owner');
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(bookFor(service)?.asks).toHaveLength(0);

    const audit = store.audits.find(
      (a) => a.entityId === order.id && a.action === AuditActionType.ORDER_CANCELLED,
    );
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe('owner');
  });

  it('throws NotFoundException when cancelling an unknown order', async () => {
    const { service } = await buildService(store);
    await expect(service.cancelOrder('nope', 'owner')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws BadRequestException when cancelling a filled order', async () => {
    const { service } = await buildService(store);

    const maker = await service.createOrder(
      'maker',
      limitSell('2', '100'),
    );
    await service.createOrder('taker', marketBuy('2'));

    expect(store.orders.find((o) => o.id === maker.id)?.status).toBe(
      OrderStatus.FILLED,
    );
    await expect(service.cancelOrder(maker.id, 'maker')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cleanupExpiredOrders expires past-due open orders and leaves valid ones alone', async () => {
    // Custom order repo that honours the `expiresAt: LessThan(...)` predicate
    // used by cleanupExpiredOrders, which the shared fake ignores.
    const base = createFakeOrderRepo(store);
    const orderRepo = {
      ...base,
      find: jest.fn(async () =>
        store.orders.filter(
          (o) =>
            (o.status === OrderStatus.OPEN ||
              o.status === OrderStatus.PARTIALLY_FILLED) &&
            o.expiresAt != null &&
            o.expiresAt < new Date(),
        ),
      ),
    };
    const { service } = await buildService(store, { orderRepo });

    // Deterministic far-future fixture, then expired in place: the in-memory
    // book holds this same object reference.
    const expiring = await service.createOrder('maker-exp', {
      ...limitSell('5', '100'),
      expiresAt: '2999-01-01T00:00:00.000Z',
    });
    expiring.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    const stored = store.orders.find((o) => o.id === expiring.id)!;
    stored.expiresAt = new Date('2020-01-01T00:00:00.000Z');

    const valid = await service.createOrder('maker-keep', {
      ...limitSell('5', '101'),
      expiresAt: '2999-01-01T00:00:00.000Z',
    });

    await service.cleanupExpiredOrders();

    expect(store.orders.find((o) => o.id === expiring.id)?.status).toBe(
      OrderStatus.EXPIRED,
    );
    expect(store.orders.find((o) => o.id === valid.id)?.status).toBe(
      OrderStatus.OPEN,
    );

    const asks = bookFor(service)?.asks.map((o) => o.id) ?? [];
    expect(asks).not.toContain(expiring.id);
    expect(asks).toContain(valid.id);

    const audit = store.audits.find(
      (a) =>
        a.entityId === expiring.id &&
        a.action === AuditActionType.ORDER_UPDATED,
    );
    expect(audit?.metadata).toMatchObject({ reason: 'Order expired' });
  });

  it('settleTrade settles an unsettled trade and records the stellar hash', async () => {
    const { service, stellar } = await buildService(store);

    await service.createOrder('maker', limitSell('6', '100'));
    await service.createOrder('taker', marketBuy('6'));

    const trade = store.trades[0];
    const settled = await service.settleTrade(trade.id!);

    expect(settled.settled).toBe(true);
    expect(settled.stellarTxHash).toBe('tx-hash');
    expect(settled.settledAt).toBeInstanceOf(Date);
    expect(stellar.executeSettlement).toHaveBeenCalledTimes(1);

    const audit = store.audits.find(
      (a) => a.entityId === trade.id && a.action === AuditActionType.TRADE_SETTLED,
    );
    expect(audit).toBeDefined();
  });

  it('settleTrade throws NotFoundException for an unknown trade', async () => {
    const { service } = await buildService(store);
    await expect(service.settleTrade('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('settleTrade throws BadRequestException when the trade is already settled', async () => {
    const { service } = await buildService(store);

    await service.createOrder('maker', limitSell('6', '100'));
    await service.createOrder('taker', marketBuy('6'));

    const trade = store.trades[0];
    await service.settleTrade(trade.id!);
    await expect(service.settleTrade(trade.id!)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getOrderById throws NotFoundException for an unknown order', async () => {
    const { service } = await buildService(store);
    await expect(service.getOrderById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
