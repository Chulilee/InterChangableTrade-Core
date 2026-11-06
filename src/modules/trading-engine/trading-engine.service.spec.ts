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
): Promise<{ service: TradingEngineService; dataSource: unknown }> {
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

  return { service: moduleRef.get(TradingEngineService), dataSource };
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
