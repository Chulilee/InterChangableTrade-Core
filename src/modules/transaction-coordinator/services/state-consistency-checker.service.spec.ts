import { StateConsistencyCheckerService } from './state-consistency-checker.service';
import { BatchLeg, LegStatus } from '../entities/batch-leg.entity';
import {
  TransactionBatch,
  BatchStatus,
} from '../entities/transaction-batch.entity';

describe('StateConsistencyCheckerService', () => {
  let service: StateConsistencyCheckerService;

  beforeEach(() => {
    service = new StateConsistencyCheckerService();
  });

  const createMockBatch = (
    overrides: Partial<TransactionBatch> = {},
  ): TransactionBatch =>
    ({
      id: 'batch-1',
      userId: 'user-1',
      name: 'Test batch',
      status: BatchStatus.CREATED,
      totalLegs: 1,
      preparedLegs: 0,
      committedLegs: 0,
      sequenceNumber: Date.now(),
      timeoutMs: 30000,
      hasConditionals: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as TransactionBatch;

  const createMockLeg = (overrides: Partial<BatchLeg> = {}): BatchLeg =>
    ({
      id: 'leg-1',
      batchId: 'batch-1',
      orderIndex: 0,
      dependencies: [],
      contractId: 'contract-1',
      method: 'swap',
      args: {},
      sourceAssetCode: 'USD',
      sourceAssetIssuer: null,
      destAssetCode: 'EUR',
      destAssetIssuer: null,
      amount: '100',
      minAmountOut: '90',
      maxAmountOut: null,
      status: LegStatus.PENDING,
      isConditional: false,
      conditionExpression: null,
      conditionType: null,
      expectedOutput: null,
      actualOutput: null,
      stellarTxHash: null,
      errorMessage: null,
      executionMetadata: null,
      preparedAt: null,
      executedAt: null,
      rolledBackAt: null,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as BatchLeg;

  describe('checkPreExecution', () => {
    it('should pass for a valid batch with pending legs', () => {
      const batch = createMockBatch();
      const legs = [createMockLeg()];

      const result = service.checkPreExecution(batch, legs);

      expect(result.passed).toBe(true);
      expect(
        result.checks.every((c) => c.passed || c.severity !== 'critical'),
      ).toBe(true);
    });

    it('should fail if batch is not in correct status', () => {
      const batch = createMockBatch({ status: BatchStatus.COMMITTED });
      const legs = [createMockLeg()];

      const result = service.checkPreExecution(batch, legs);

      expect(result.passed).toBe(false);
      const batchStatusCheck = result.checks.find(
        (c) => c.name === 'batch_status',
      );
      expect(batchStatusCheck?.passed).toBe(false);
    });

    it('should fail if amounts are non-positive', () => {
      const batch = createMockBatch();
      const legs = [createMockLeg({ amount: '0' })];

      const result = service.checkPreExecution(batch, legs);

      expect(result.passed).toBe(false);
      const amountCheck = result.checks.find(
        (c) => c.name === 'positive_amounts',
      );
      expect(amountCheck?.passed).toBe(false);
    });

    it('should warn if minAmountOut > amount', () => {
      const batch = createMockBatch();
      const legs = [createMockLeg({ minAmountOut: '200', amount: '100' })];

      const result = service.checkPreExecution(batch, legs);

      const minOutCheck = result.checks.find(
        (c) => c.name === 'min_amount_out_bounds',
      );
      expect(minOutCheck?.passed).toBe(false);
      expect(minOutCheck?.severity).toBe('warning');
    });

    it('should fail if conditional leg is missing configuration', () => {
      const batch = createMockBatch();
      const legs = [
        createMockLeg({
          isConditional: true,
          conditionExpression: null,
          conditionType: null,
        }),
      ];

      const result = service.checkPreExecution(batch, legs);

      expect(result.passed).toBe(false);
      const condCheck = result.checks.find(
        (c) => c.name === 'conditional_legs_config',
      );
      expect(condCheck?.passed).toBe(false);
    });

    it('should fail if maxAmountOut < minAmountOut', () => {
      const batch = createMockBatch();
      const legs = [createMockLeg({ minAmountOut: '100', maxAmountOut: '50' })];

      const result = service.checkPreExecution(batch, legs);

      expect(result.passed).toBe(false);
      const boundsCheck = result.checks.find((c) => c.name === 'price_bounds');
      expect(boundsCheck?.passed).toBe(false);
    });
  });

  describe('checkPostPrepare', () => {
    it('should pass when all legs are prepared', () => {
      const batch = createMockBatch({ preparedLegs: 1 });
      const legs = [createMockLeg({ status: LegStatus.PREPARED })];

      const result = service.checkPostPrepare(batch, legs);

      expect(result.passed).toBe(true);
    });

    it('should fail if not all legs are prepared', () => {
      const batch = createMockBatch({ preparedLegs: 0 });
      const legs = [createMockLeg({ status: LegStatus.FAILED })];

      const result = service.checkPostPrepare(batch, legs);

      expect(result.passed).toBe(false);
    });

    it('should fail if expected output is below minimum', () => {
      const batch = createMockBatch({ preparedLegs: 1 });
      const legs = [
        createMockLeg({
          status: LegStatus.PREPARED,
          expectedOutput: '50',
          minAmountOut: '90',
        }),
      ];

      const result = service.checkPostPrepare(batch, legs);

      expect(result.passed).toBe(false);
      const outputCheck = result.checks.find(
        (c) => c.name === 'expected_output_bounds',
      );
      expect(outputCheck?.passed).toBe(false);
    });

    it('should pass when skipped legs are treated as prepared', () => {
      const batch = createMockBatch({ preparedLegs: 0 });
      const legs = [createMockLeg({ status: LegStatus.SKIPPED })];

      const result = service.checkPostPrepare(batch, legs);

      expect(result.passed).toBe(true);
    });
  });

  describe('checkPostCommit', () => {
    it('should pass when all legs are executed with valid outputs', () => {
      const batch = createMockBatch();
      const legs = [
        createMockLeg({
          status: LegStatus.EXECUTED,
          actualOutput: '95',
          minAmountOut: '90',
          stellarTxHash: 'tx-123',
        }),
      ];

      const result = service.checkPostCommit(batch, legs);

      expect(result.passed).toBe(true);
    });

    it('should fail if actual output is below minimum', () => {
      const batch = createMockBatch();
      const legs = [
        createMockLeg({
          status: LegStatus.EXECUTED,
          actualOutput: '80',
          minAmountOut: '90',
          stellarTxHash: 'tx-123',
        }),
      ];

      const result = service.checkPostCommit(batch, legs);

      expect(result.passed).toBe(false);
    });

    it('should fail if actual output is negative', () => {
      const batch = createMockBatch();
      const legs = [
        createMockLeg({
          status: LegStatus.EXECUTED,
          actualOutput: '-10',
          minAmountOut: '0',
          stellarTxHash: 'tx-123',
        }),
      ];

      const result = service.checkPostCommit(batch, legs);

      expect(result.passed).toBe(false);
    });

    it('should warn if committed leg is missing tx hash', () => {
      const batch = createMockBatch();
      const legs = [
        createMockLeg({
          status: LegStatus.EXECUTED,
          actualOutput: '95',
          minAmountOut: '90',
          stellarTxHash: null,
        }),
      ];

      const result = service.checkPostCommit(batch, legs);

      const txHashCheck = result.checks.find(
        (c) => c.name === 'tx_hashes_present',
      );
      expect(txHashCheck?.passed).toBe(false);
    });
  });

  describe('checkPostRollback', () => {
    it('should pass when all legs are in terminal state', () => {
      const batch = createMockBatch({ status: BatchStatus.ROLLED_BACK });
      const legs = [
        createMockLeg({ status: LegStatus.ROLLED_BACK }),
        createMockLeg({ status: LegStatus.FAILED, orderIndex: 1, id: 'leg-2' }),
      ];

      const result = service.checkPostRollback(batch, legs);

      expect(result.passed).toBe(true);
    });

    it('should fail if legs are in intermediate state', () => {
      const batch = createMockBatch({ status: BatchStatus.ROLLING_BACK });
      const legs = [createMockLeg({ status: LegStatus.PREPARING })];

      const result = service.checkPostRollback(batch, legs);

      expect(result.passed).toBe(false);
    });
  });

  describe('evaluateCondition', () => {
    it('should evaluate price_gt correctly', () => {
      expect(service.evaluateCondition('price_gt', '1.05', '1.10')).toBe(true);
      expect(service.evaluateCondition('price_gt', '1.05', '1.00')).toBe(false);
      expect(service.evaluateCondition('price_gt', '1.05', '1.05')).toBe(false);
    });

    it('should evaluate price_lt correctly', () => {
      expect(service.evaluateCondition('price_lt', '1.05', '1.00')).toBe(true);
      expect(service.evaluateCondition('price_lt', '1.05', '1.10')).toBe(false);
    });

    it('should evaluate price_gte correctly', () => {
      expect(service.evaluateCondition('price_gte', '1.05', '1.05')).toBe(true);
      expect(service.evaluateCondition('price_gte', '1.05', '1.04')).toBe(
        false,
      );
    });

    it('should evaluate price_lte correctly', () => {
      expect(service.evaluateCondition('price_lte', '1.05', '1.05')).toBe(true);
      expect(service.evaluateCondition('price_lte', '1.05', '1.06')).toBe(
        false,
      );
    });

    it('should return false for invalid values', () => {
      expect(service.evaluateCondition('price_gt', 'abc', '1.0')).toBe(false);
      expect(service.evaluateCondition('price_gt', '1.0', 'abc')).toBe(false);
    });

    it('should return false for unknown condition types', () => {
      expect(service.evaluateCondition('unknown', '1.0', '1.0')).toBe(false);
    });
  });
});
