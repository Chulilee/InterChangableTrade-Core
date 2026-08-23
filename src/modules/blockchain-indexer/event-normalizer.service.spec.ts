import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventNormalizer } from './services/event-normalizer.service';
import { BlockchainEventType } from './entities/blockchain-event.entity';
import { ParsedContractEvent } from '../stellar/soroban/soroban.types';

describe('EventNormalizer', () => {
  let module: TestingModule;
  let normalizer: EventNormalizer;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [EventNormalizer],
    }).compile();

    normalizer = module.get(EventNormalizer);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(() => {
    normalizer.initializeSequenceCounter(BigInt(0));
  });

  describe('normalizeStellarOperations', () => {
    const mockTx = {
      hash: 'tx123',
      ledger: 50000,
      created_at: '2024-01-15T10:30:00Z',
      source_account: 'GABC...',
      fee_charged: '100',
      successful: true,
      paging_token: '50000_0',
    };

    it('should normalize payment operations', () => {
      const operations = [
        {
          transaction_hash: 'tx123',
          application_index: 0,
          type: 'payment',
          asset_code: 'USD',
          asset_issuer: 'GDEF...',
          from: 'GABC...',
          to: 'GXYZ...',
          amount: '100.50',
        },
      ];

      const events = normalizer.normalizeStellarOperations(mockTx as any, operations);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(BlockchainEventType.PAYMENT);
      expect(events[0].transactionHash).toBe('tx123');
      expect(events[0].ledgerSequence).toBe(50000);
      expect(events[0].sourceAccount).toBe('GABC...');
      expect(events[0].destinationAccount).toBe('GXYZ...');
      expect(events[0].assetCode).toBe('USD');
      expect(events[0].amount).toBe('100.50');
    });

    it('should normalize manage offer operations', () => {
      const operations = [
        {
          transaction_hash: 'tx123',
          application_index: 1,
          type: 'manage_offer',
          asset_code: 'BTC',
          asset_issuer: 'GDEF...',
          from: 'GABC...',
          amount: '0.5',
        },
      ];

      const events = normalizer.normalizeStellarOperations(mockTx as any, operations);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(BlockchainEventType.MANAGE_OFFER);
    });

    it('should skip irrelevant operation types', () => {
      const operations = [
        {
          transaction_hash: 'tx123',
          application_index: 0,
          type: 'bump_sequence',
        },
      ];

      const events = normalizer.normalizeStellarOperations(mockTx as any, operations);

      expect(events).toHaveLength(0);
    });

    it('should handle create_account operations', () => {
      const operations = [
        {
          transaction_hash: 'tx123',
          application_index: 0,
          type: 'create_account',
          to: 'GNEW...',
          from: 'GABC...',
          starting_balance: '10',
        },
      ];

      const events = normalizer.normalizeStellarOperations(mockTx as any, operations);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(BlockchainEventType.CREATE_ACCOUNT);
      expect(events[0].destinationAccount).toBe('GNEW...');
      expect(events[0].amount).toBe('10');
    });
  });

  describe('normalizeSorobanEvent', () => {
    it('should normalize a contract event', () => {
      const sorobanEvent: ParsedContractEvent = {
        id: 'soroban_event_1',
        contractId: 'CCONTRACT...',
        type: 'contract',
        ledger: 60000,
        ledgerClosedAt: '2024-01-15T11:00:00Z',
        topics: ['transfer', 'GABC...', 'GXYZ...'],
        value: { amount: 1000, symbol: 'TOKEN' },
        txHash: 'tx_soroban_1',
        pagingToken: 'soroban_1',
        indexedAt: Date.now(),
      };

      const event = normalizer.normalizeSorobanEvent(sorobanEvent);

      expect(event.eventType).toBe(
        BlockchainEventType.SOROBAN_CONTRACT_EVENT,
      );
      expect(event.contractId).toBe('CCONTRACT...');
      expect(event.methodName).toBe('transfer');
      expect(event.topics).toEqual(['transfer', 'GABC...', 'GXYZ...']);
      expect(event.value).toEqual({ amount: 1000, symbol: 'TOKEN' });
      expect(event.transactionHash).toBe('tx_soroban_1');
    });

    it('should normalize a system event', () => {
      const sorobanEvent: ParsedContractEvent = {
        id: 'soroban_sys_1',
        contractId: '',
        type: 'system',
        ledger: 60001,
        ledgerClosedAt: '2024-01-15T11:00:01Z',
        topics: ['contract crédito'],
        value: {},
        txHash: 'tx_sys_1',
        pagingToken: 'sys_1',
        indexedAt: Date.now(),
      };

      const event = normalizer.normalizeSorobanEvent(sorobanEvent);

      expect(event.eventType).toBe(
        BlockchainEventType.SOROBAN_SYSTEM_EVENT,
      );
    });
  });

  describe('sequence counter', () => {
    it('should initialize from a given value', () => {
      normalizer.initializeSequenceCounter(BigInt(100));
      expect(normalizer.getCurrentSequence()).toBe(BigInt(100));
    });

    it('should increment sequence numbers monotonically', () => {
      normalizer.initializeSequenceCounter(BigInt(0));

      const seq1 = normalizer.getNextSequence();
      const seq2 = normalizer.getNextSequence();
      const seq3 = normalizer.getNextSequence();

      expect(seq1).toBe(BigInt(1));
      expect(seq2).toBe(BigInt(2));
      expect(seq3).toBe(BigInt(3));
    });

    it('should assign sequences to events via assignSequence', () => {
      normalizer.initializeSequenceCounter(BigInt(0));

      const input = {
        ledgerSequence: 100,
        eventType: BlockchainEventType.PAYMENT,
        transactionHash: 'tx1',
        timestamp: new Date(),
        sourceAccount: 'GABC...',
        raw: {},
        invalidated: false,
      };

      const result = normalizer.assignSequence(input);
      expect(result.sequenceNumber).toBe('1');

      const result2 = normalizer.assignSequence(input);
      expect(result2.sequenceNumber).toBe('2');
    });
  });
});
