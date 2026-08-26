import {
  Transaction,
  TransactionStatus,
} from '../../entities/transaction.entity';
import {
  BASE_FEE_STROOPS,
  NetSettlementService,
} from '../net-settlement.service';

const tx = (over: Partial<Transaction>): Transaction =>
  ({
    id: 'tx-' + Math.random().toString(36).slice(2),
    status: 'pending',
    type: 'trade',
    assetCode: 'XLM',
    assetIssuer: null,
    amount: '0',
    fromAccount: 'A',
    toAccount: 'B',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as Transaction;

describe('NetSettlementService', () => {
  let service: NetSettlementService;

  beforeEach(() => {
    service = new NetSettlementService();
  });

  describe('computeNetSettlement', () => {
    it('nets opposing flows between the same pair into one transfer', () => {
      const transfers = service.computeNetSettlement([
        tx({ fromAccount: 'A', toAccount: 'B', amount: '10' }),
        tx({ fromAccount: 'B', toAccount: 'A', amount: '4' }),
      ]);
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        fromAccount: 'A',
        toAccount: 'B',
        amount: '6',
      });
    });

    it('fully cancels cyclic flows (A→B→C→A)', () => {
      const transfers = service.computeNetSettlement([
        tx({ fromAccount: 'A', toAccount: 'B', amount: '5' }),
        tx({ fromAccount: 'B', toAccount: 'C', amount: '5' }),
        tx({ fromAccount: 'C', toAccount: 'A', amount: '5' }),
      ]);
      expect(transfers).toHaveLength(0);
    });

    it('separates assets into independent netting groups', () => {
      const transfers = service.computeNetSettlement([
        tx({
          fromAccount: 'A',
          toAccount: 'B',
          amount: '10',
          assetCode: 'XLM',
        }),
        tx({
          fromAccount: 'B',
          toAccount: 'A',
          amount: '10',
          assetCode: 'USDC',
          assetIssuer: 'ISSUER',
        }),
      ]);
      // Different assets never cancel each other.
      expect(transfers).toHaveLength(2);
      const codes = transfers.map((t) => t.assetCode).sort();
      expect(codes).toEqual(['USDC', 'XLM']);
      expect(transfers.find((t) => t.assetCode === 'USDC')?.assetIssuer).toBe(
        'ISSUER',
      );
    });

    it('settles many-to-many flows with fewer transfers than inputs', () => {
      // 6 transactions across 4 accounts, all in XLM.
      const input = [
        tx({ fromAccount: 'A', toAccount: 'B', amount: '3' }),
        tx({ fromAccount: 'B', toAccount: 'C', amount: '2.5' }),
        tx({ fromAccount: 'C', toAccount: 'D', amount: '1.25' }),
        tx({ fromAccount: 'D', toAccount: 'A', amount: '0.75' }),
        tx({ fromAccount: 'A', toAccount: 'C', amount: '4' }),
        tx({ fromAccount: 'B', toAccount: 'D', amount: '2' }),
      ];
      const transfers = service.computeNetSettlement(input);
      // Reduction must beat the 30% acceptance criterion.
      const reduction = 1 - transfers.length / input.length;
      expect(reduction).toBeGreaterThanOrEqual(0.3);

      // And the net result must be exactly equivalent: verify per-account
      // balances of input vs output match.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balance = (list: any[], account: string) =>
        list
          .reduce(
            (acc, t) =>
              acc +
              (t.toAccount === account ? Number(t.amount) : 0) -
              (t.fromAccount === account ? Number(t.amount) : 0),
            0,
          )
          .toFixed(7);

      for (const account of ['A', 'B', 'C', 'D']) {
        expect(balance(transfers, account)).toBe(balance(input, account));
      }
    });

    it('handles precision without float drift', () => {
      const transfers = service.computeNetSettlement([
        tx({ fromAccount: 'A', toAccount: 'B', amount: '0.1' }),
        tx({ fromAccount: 'B', toAccount: 'A', amount: '0.1' }),
      ]);
      expect(transfers).toHaveLength(0);
    });

    it('ignores invalid members instead of throwing', () => {
      const transfers = service.computeNetSettlement([
        tx({ fromAccount: '', toAccount: 'B', amount: '5' }),
        tx({ fromAccount: 'A', toAccount: '', amount: '5' }),
        tx({ fromAccount: 'A', toAccount: 'B', amount: '0' }),
        tx({ fromAccount: 'A', toAccount: 'B', amount: '-3' }),
        tx({ fromAccount: 'A', toAccount: 'B', amount: '1' }),
      ]);
      expect(transfers).toHaveLength(1);
      expect(transfers[0].amount).toBe('1');
    });
  });

  describe('validateComposition', () => {
    it('rejects transactions with missing accounts, bad amounts or wrong status', () => {
      const { eligible, rejected } = service.validateComposition([
        tx({ id: 'ok', amount: '5' }),
        tx({ id: 'no-from', fromAccount: '' }),
        tx({ id: 'zero', amount: '0' }),
        tx({ id: 'done', status: TransactionStatus.SUCCESS, amount: '5' }),
      ]);
      expect(eligible.map((t) => t.id)).toEqual(['ok']);
      expect(rejected).toEqual([
        { transactionId: 'no-from', reason: 'missing from/to account' },
        { transactionId: 'zero', reason: 'non-positive amount' },
        { transactionId: 'done', reason: 'not pending' },
      ]);
    });
  });

  describe('analyzeFees', () => {
    it('computes savings percentage from transaction counts', () => {
      const analysis = service.analyzeFees(50, new Array(10).fill({}));
      expect(analysis.feeBeforeStroops).toBe(String(50 * BASE_FEE_STROOPS));
      expect(analysis.feeAfterStroops).toBe(String(10 * BASE_FEE_STROOPS));
      expect(analysis.savingsPercent).toBe('80.00');
      expect(Number(analysis.savingsPercent)).toBeGreaterThan(20);
    });

    it('reports zero savings when there is nothing to batch', () => {
      expect(service.analyzeFees(0, []).savingsPercent).toBe('0.00');
    });
  });

  describe('formatAmount', () => {
    it('round-trips fractional and whole amounts', () => {
      expect(service.formatAmount(60_000_000)).toBe('6');
      expect(service.formatAmount(6_123_456_789)).toBe('612.3456789');
      expect(service.formatAmount(-250_000_000)).toBe('-25');
    });
  });
});
