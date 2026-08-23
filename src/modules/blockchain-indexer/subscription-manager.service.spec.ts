import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  SubscriptionManager,
  NormalizedEventPayload,
} from './services/subscription-manager.service';

describe('SubscriptionManager', () => {
  let module: TestingModule;
  let manager: SubscriptionManager;

  const makeEvent = (
    overrides: Partial<NormalizedEventPayload> = {},
  ): NormalizedEventPayload => ({
    sequenceNumber: 1,
    ledgerSequence: 50000,
    eventType: 'payment',
    transactionHash: 'tx1',
    timestamp: '2024-01-15T10:30:00Z',
    sourceAccount: 'GABC...',
    ...overrides,
  });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [SubscriptionManager],
    }).compile();

    manager = module.get(SubscriptionManager);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    // Clean up all subscriptions.
    for (const sub of manager.listSubscriptions()) {
      manager.unsubscribe(sub.id);
    }
  });

  describe('subscribe / unsubscribe', () => {
    it('should create a subscription and return an ID', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: ['payment'],
      });
      expect(id).toBeDefined();
      expect(id).toMatch(/^sub_/);
      expect(manager.getSubscriptionCount()).toBe(1);
    });

    it('should remove a subscription by ID', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: [],
      });
      const removed = manager.unsubscribe(id);
      expect(removed).toBe(true);
      expect(manager.getSubscriptionCount()).toBe(0);
    });

    it('should return false for non-existent subscription', () => {
      const removed = manager.unsubscribe('sub_nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('removeClientSubscriptions', () => {
    it('should remove all subscriptions for a client', () => {
      manager.subscribe({ clientId: 'client1', eventTypes: ['payment'] });
      manager.subscribe({ clientId: 'client1', eventTypes: ['trade'] });
      manager.subscribe({ clientId: 'client2', eventTypes: ['payment'] });

      const removed = manager.removeClientSubscriptions('client1');

      expect(removed).toBe(2);
      expect(manager.getSubscriptionCount()).toBe(1);
    });

    it('should return 0 for unknown client', () => {
      const removed = manager.removeClientSubscriptions('unknown');
      expect(removed).toBe(0);
    });
  });

  describe('distributeEvent', () => {
    it('should match all events when eventTypes is empty', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: [],
      });

      const event = makeEvent({ eventType: 'payment' });
      const matched = manager.distributeEvent(event);

      expect(matched).toContain(id);
    });

    it('should match events by type', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: ['payment', 'trade'],
      });

      const payment = makeEvent({ eventType: 'payment' });
      const trade = makeEvent({ eventType: 'trade' });
      const liquidation = makeEvent({ eventType: 'liquidation' });

      expect(manager.distributeEvent(payment)).toContain(id);
      expect(manager.distributeEvent(trade)).toContain(id);
      expect(manager.distributeEvent(liquidation)).not.toContain(id);
    });

    it('should match events by contractId', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: [],
        contractIds: ['CCONTRACT1...'],
      });

      const match = makeEvent({
        contractId: 'CCONTRACT1...',
        eventType: 'soroban_contract_event',
      });
      const noMatch = makeEvent({
        contractId: 'CCONTRACT2...',
        eventType: 'soroban_contract_event',
      });

      expect(manager.distributeEvent(match)).toContain(id);
      expect(manager.distributeEvent(noMatch)).not.toContain(id);
    });

    it('should match events by account', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: [],
        accounts: ['GABC...'],
      });

      const sourceMatch = makeEvent({ sourceAccount: 'GABC...' });
      const destMatch = makeEvent({
        sourceAccount: 'GOTHER...',
        destinationAccount: 'GABC...',
      });
      const noMatch = makeEvent({
        sourceAccount: 'GOTHER...',
        destinationAccount: 'GXYZ...',
      });

      expect(manager.distributeEvent(sourceMatch)).toContain(id);
      expect(manager.distributeEvent(destMatch)).toContain(id);
      expect(manager.distributeEvent(noMatch)).not.toContain(id);
    });

    it('should match events by ledger sequence', () => {
      const id = manager.subscribe({
        clientId: 'client1',
        eventTypes: [],
        fromLedger: 50000,
      });

      const match = makeEvent({ ledgerSequence: 50001 });
      const noMatch = makeEvent({ ledgerSequence: 49999 });

      expect(manager.distributeEvent(match)).toContain(id);
      expect(manager.distributeEvent(noMatch)).not.toContain(id);
    });

    it('should emit events to the correct client', () => {
      const events: any[] = [];
      manager.on('event:client1', (payload) => events.push(payload));

      manager.subscribe({
        clientId: 'client1',
        eventTypes: ['payment'],
      });

      manager.distributeEvent(makeEvent({ eventType: 'payment' }));
      manager.distributeEvent(makeEvent({ eventType: 'trade' }));

      expect(events).toHaveLength(1);
      expect(events[0].event.eventType).toBe('payment');
    });
  });

  describe('listSubscriptions', () => {
    it('should list all subscriptions', () => {
      manager.subscribe({ clientId: 'client1', eventTypes: ['payment'] });
      manager.subscribe({ clientId: 'client2', eventTypes: ['trade'] });

      const all = manager.listSubscriptions();
      expect(all).toHaveLength(2);
    });

    it('should filter by client ID', () => {
      manager.subscribe({ clientId: 'client1', eventTypes: ['payment'] });
      manager.subscribe({ clientId: 'client2', eventTypes: ['trade'] });

      const client1Subs = manager.listSubscriptions('client1');
      expect(client1Subs).toHaveLength(1);
      expect(client1Subs[0].clientId).toBe('client1');
    });
  });

  describe('getClientCount', () => {
    it('should count unique clients', () => {
      manager.subscribe({ clientId: 'client1', eventTypes: ['payment'] });
      manager.subscribe({ clientId: 'client1', eventTypes: ['trade'] });
      manager.subscribe({ clientId: 'client2', eventTypes: ['payment'] });

      expect(manager.getClientCount()).toBe(2);
    });
  });
});
