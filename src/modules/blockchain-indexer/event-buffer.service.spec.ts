import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  EventBufferService,
  BufferedEvent,
} from './services/event-buffer.service';

describe('EventBufferService', () => {
  let module: TestingModule;
  let buffer: EventBufferService;

  const makeEvent = (
    seq: number,
    ledger: number = seq * 10,
  ): BufferedEvent => ({
    sequenceNumber: seq,
    ledgerSequence: ledger,
    eventType: 'payment',
    timestamp: Date.now(),
    data: { hash: `tx_${seq}` },
    bufferedAt: Date.now(),
  });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [EventBufferService],
    }).compile();

    buffer = module.get(EventBufferService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    buffer.reset();
  });

  describe('push', () => {
    it('should accept a new event', () => {
      const accepted = buffer.push(makeEvent(1));
      expect(accepted).toBe(true);
      expect(buffer.getStats().bufferSize).toBe(1);
    });

    it('should reject duplicate sequence numbers', () => {
      buffer.push(makeEvent(1));
      const accepted = buffer.push(makeEvent(1));
      expect(accepted).toBe(false);
      expect(buffer.getStats().bufferSize).toBe(1);
      expect(buffer.getStats().totalDuplicates).toBe(1);
    });

    it('should track receive stats', () => {
      buffer.push(makeEvent(1));
      buffer.push(makeEvent(2));
      const stats = buffer.getStats();
      expect(stats.totalReceived).toBe(2);
    });
  });

  describe('pushBatch', () => {
    it('should accept all unique events', () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
      const accepted = buffer.pushBatch(events);
      expect(accepted).toBe(3);
      expect(buffer.getStats().bufferSize).toBe(3);
    });

    it('should skip duplicates in a batch', () => {
      buffer.push(makeEvent(1));
      const events = [makeEvent(1), makeEvent(2)];
      const accepted = buffer.pushBatch(events);
      expect(accepted).toBe(1); // Only event 2 is new
      expect(buffer.getStats().bufferSize).toBe(2);
    });
  });

  describe('drain', () => {
    it('should return events in sequence order', () => {
      buffer.push(makeEvent(3));
      buffer.push(makeEvent(1));
      buffer.push(makeEvent(2));

      const drained = buffer.drain(10);

      expect(drained).toHaveLength(3);
      expect(drained[0].sequenceNumber).toBe(1);
      expect(drained[1].sequenceNumber).toBe(2);
      expect(drained[2].sequenceNumber).toBe(3);
    });

    it('should remove drained events from buffer', () => {
      buffer.push(makeEvent(1));
      buffer.push(makeEvent(2));

      buffer.drain(1);

      expect(buffer.getStats().bufferSize).toBe(1);
    });

    it('should respect maxCount limit', () => {
      buffer.push(makeEvent(1));
      buffer.push(makeEvent(2));
      buffer.push(makeEvent(3));

      const drained = buffer.drain(2);

      expect(drained).toHaveLength(2);
      expect(buffer.getStats().bufferSize).toBe(1);
    });

    it('should return empty array when buffer is empty', () => {
      const drained = buffer.drain(10);
      expect(drained).toHaveLength(0);
    });
  });

  describe('peek', () => {
    it('should return events without removing them', () => {
      buffer.push(makeEvent(1));
      buffer.push(makeEvent(2));

      const peeked = buffer.peek(10);

      expect(peeked).toHaveLength(2);
      expect(buffer.getStats().bufferSize).toBe(2);
    });
  });

  describe('evictExpired', () => {
    it('should evict events older than TTL', () => {
      buffer.push(makeEvent(1));

      // Manually backdate the bufferedAt to exceed the TTL.
      const events = buffer.peek(1);
      (events[0] as any).bufferedAt = Date.now() - 200000;

      buffer.evictExpired();

      expect(buffer.getStats().bufferSize).toBe(0);
      expect(buffer.getStats().totalExpired).toBe(1);
    });

    it('should keep recent events', () => {
      buffer.push(makeEvent(1));
      buffer.evictExpired();
      expect(buffer.getStats().bufferSize).toBe(1);
    });
  });

  describe('ordering guarantees', () => {
    it('should maintain monotonic ordering after out-of-order pushes', () => {
      // Push events out of order.
      for (const seq of [5, 1, 9, 3, 7, 2, 8, 4, 6]) {
        buffer.push(makeEvent(seq));
      }

      const drained = buffer.drain(100);

      expect(drained.map((e) => e.sequenceNumber)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });
  });
});
