import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  SETTLEMENT_EXECUTOR,
  StellarSettlementExecutor,
} from '../settlement-executor';
import { NetTransfer } from '../entities/settlement-batch.entity';

const transfer = (over: Partial<NetTransfer> = {}): NetTransfer => ({
  fromAccount: 'A',
  toAccount: 'B',
  assetCode: 'XLM',
  assetIssuer: null,
  amount: '5',
  ...over,
});

describe('StellarSettlementExecutor', () => {
  let executor: StellarSettlementExecutor;
  let config: Record<string, jest.Mock>;

  beforeEach(async () => {
    config = { get: jest.fn().mockReturnValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        StellarSettlementExecutor,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    executor = moduleRef.get<StellarSettlementExecutor>(
      StellarSettlementExecutor,
    );
    expect(SETTLEMENT_EXECUTOR).toBe('SETTLEMENT_EXECUTOR');
  });

  it('is a no-op for an empty transfer list', async () => {
    const result = await executor.execute([]);
    expect(result).toEqual({ hash: null, ledger: null });
  });

  it('settles in dry-run mode when no settlement key is configured', async () => {
    const result = await executor.execute([transfer()]);
    // Dry run reports success without an on-chain hash.
    expect(result.hash).toBeNull();
  });

  it('rollback is a safe no-op for the txset-based executor', async () => {
    await expect(executor.rollback()).resolves.toBeUndefined();
  });
});
