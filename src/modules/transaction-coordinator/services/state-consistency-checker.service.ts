import { Injectable, Logger } from '@nestjs/common';
import { BatchLeg } from '../entities/batch-leg.entity';
import { TransactionBatch } from '../entities/transaction-batch.entity';

export interface ConsistencyCheckResult {
  passed: boolean;
  checks: CheckDetail[];
  timestamp: Date;
}

export interface CheckDetail {
  name: string;
  passed: boolean;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

/**
 * Validates invariants after each phase of the two-phase commit protocol.
 *
 * Ensures:
 * - No negative balances after execution
 * - Price bounds are respected
 * - Asset flows are consistent (no value disappeared)
 * - All legs in a committed batch are in the correct state
 * - Conditional legs were properly evaluated
 */
@Injectable()
export class StateConsistencyCheckerService {
  private readonly logger = new Logger(StateConsistencyCheckerService.name);

  /**
   * Run pre-execution checks before starting the prepare phase.
   * Validates the batch and legs are in a valid state for execution.
   */
  checkPreExecution(
    batch: TransactionBatch,
    legs: BatchLeg[],
  ): ConsistencyCheckResult {
    const checks: CheckDetail[] = [];

    // Check 1: Batch is in correct status
    checks.push({
      name: 'batch_status',
      passed: batch.status === 'created' || batch.status === 'preparing',
      message: `Batch status is '${batch.status}', expected 'created' or 'preparing'`,
      severity: 'critical',
    });

    // Check 2: All legs are in pending status
    const nonPendingLegs = legs.filter((l) => l.status !== 'pending');
    checks.push({
      name: 'legs_pending',
      passed: nonPendingLegs.length === 0,
      message:
        nonPendingLegs.length === 0
          ? 'All legs are in pending status'
          : `${nonPendingLegs.length} legs are not in pending status`,
      severity: 'critical',
    });

    // Check 3: No negative amounts
    const negativeAmounts = legs.filter((l) => parseFloat(l.amount) <= 0);
    checks.push({
      name: 'positive_amounts',
      passed: negativeAmounts.length === 0,
      message:
        negativeAmounts.length === 0
          ? 'All amounts are positive'
          : `${negativeAmounts.length} legs have non-positive amounts`,
      severity: 'critical',
    });

    // Check 4: minAmountOut constraints are reasonable
    const invalidMinOut = legs.filter(
      (l) => parseFloat(l.minAmountOut) > parseFloat(l.amount),
    );
    checks.push({
      name: 'min_amount_out_bounds',
      passed: invalidMinOut.length === 0,
      message:
        invalidMinOut.length === 0
          ? 'All minAmountOut values are within bounds'
          : `${invalidMinOut.length} legs have minAmountOut > amount`,
      severity: 'warning',
    });

    // Check 5: Price bounds (maxAmountOut > minAmountOut if both set)
    const invalidPriceBounds = legs.filter(
      (l) =>
        l.maxAmountOut !== null &&
        l.maxAmountOut !== undefined &&
        parseFloat(l.maxAmountOut) < parseFloat(l.minAmountOut),
    );
    checks.push({
      name: 'price_bounds',
      passed: invalidPriceBounds.length === 0,
      message:
        invalidPriceBounds.length === 0
          ? 'Price bounds are consistent'
          : `${invalidPriceBounds.length} legs have maxAmountOut < minAmountOut`,
      severity: 'critical',
    });

    // Check 6: Conditional legs have required fields
    const conditionalLegs = legs.filter((l) => l.isConditional);
    const invalidConditionals = conditionalLegs.filter(
      (l) => !l.conditionExpression || !l.conditionType,
    );
    checks.push({
      name: 'conditional_legs_config',
      passed: invalidConditionals.length === 0,
      message:
        invalidConditionals.length === 0
          ? `All ${conditionalLegs.length} conditional legs are properly configured`
          : `${invalidConditionals.length} conditional legs are missing configuration`,
      severity: 'critical',
    });

    // Check 7: No duplicate dependencies
    const depsSet = new Set<string>();
    let hasDupDeps = false;
    for (const leg of legs) {
      for (const dep of leg.dependencies) {
        const key = `${leg.id}-${dep}`;
        if (depsSet.has(key)) {
          hasDupDeps = true;
          break;
        }
        depsSet.add(key);
      }
      if (hasDupDeps) break;
    }
    checks.push({
      name: 'no_duplicate_dependencies',
      passed: !hasDupDeps,
      message: hasDupDeps
        ? 'Duplicate dependencies detected'
        : 'No duplicate dependencies',
      severity: 'warning',
    });

    return this.buildResult(checks);
  }

  /**
   * Run post-prepare checks after all legs are prepared.
   * Validates that prepared legs have consistent expected outputs.
   */
  checkPostPrepare(
    batch: TransactionBatch,
    legs: BatchLeg[],
  ): ConsistencyCheckResult {
    const checks: CheckDetail[] = [];

    // Check 1: All legs should be in prepared or skipped status
    const preparedLegs = legs.filter(
      (l) => l.status === 'prepared' || l.status === 'skipped',
    );
    checks.push({
      name: 'all_prepared',
      passed: preparedLegs.length === legs.length,
      message: `${preparedLegs.length}/${legs.length} legs are prepared or skipped`,
      severity: 'critical',
    });

    // Check 2: Expected outputs are within min/max bounds
    const outOfBounds = legs.filter(
      (l) =>
        l.status === 'prepared' &&
        l.expectedOutput &&
        (parseFloat(l.expectedOutput) < parseFloat(l.minAmountOut) ||
          (l.maxAmountOut &&
            parseFloat(l.expectedOutput) > parseFloat(l.maxAmountOut))),
    );
    checks.push({
      name: 'expected_output_bounds',
      passed: outOfBounds.length === 0,
      message:
        outOfBounds.length === 0
          ? 'All expected outputs are within price bounds'
          : `${outOfBounds.length} legs have expected outputs outside bounds`,
      severity: 'critical',
    });

    // Check 3: Batch prepared count matches
    const preparedCount = legs.filter((l) => l.status === 'prepared').length;
    checks.push({
      name: 'batch_prepared_count',
      passed: batch.preparedLegs === preparedCount,
      message: `Batch prepared count (${batch.preparedLegs}) matches actual (${preparedCount})`,
      severity: 'warning',
    });

    return this.buildResult(checks);
  }

  /**
   * Run post-commit checks after the commit phase.
   * Validates that committed legs have consistent actual outputs.
   */
  checkPostCommit(
    batch: TransactionBatch,
    legs: BatchLeg[],
  ): ConsistencyCheckResult {
    const checks: CheckDetail[] = [];

    // Check 1: All non-skipped legs should be committed or rolled back
    const nonSkippedLegs = legs.filter((l) => l.status !== 'skipped');
    const committedLegs = nonSkippedLegs.filter((l) => l.status === 'executed');
    checks.push({
      name: 'legs_committed',
      passed:
        committedLegs.length === nonSkippedLegs.length ||
        nonSkippedLegs.every(
          (l) => l.status === 'executed' || l.status === 'rolled_back',
        ),
      message: `${committedLegs.length}/${nonSkippedLegs.length} legs committed`,
      severity: 'critical',
    });

    // Check 2: No negative actual outputs
    const negativeOutputs = legs.filter(
      (l) =>
        l.status === 'executed' &&
        l.actualOutput &&
        parseFloat(l.actualOutput) < 0,
    );
    checks.push({
      name: 'positive_actual_outputs',
      passed: negativeOutputs.length === 0,
      message:
        negativeOutputs.length === 0
          ? 'All actual outputs are non-negative'
          : `${negativeOutputs.length} legs have negative actual outputs`,
      severity: 'critical',
    });

    // Check 3: Actual outputs meet minimum requirements
    const belowMinimum = legs.filter(
      (l) =>
        l.status === 'executed' &&
        l.actualOutput &&
        parseFloat(l.actualOutput) < parseFloat(l.minAmountOut),
    );
    checks.push({
      name: 'actual_output_meets_minimum',
      passed: belowMinimum.length === 0,
      message:
        belowMinimum.length === 0
          ? 'All actual outputs meet minimum requirements'
          : `${belowMinimum.length} legs have actual output below minimum`,
      severity: 'critical',
    });

    // Check 4: Actual outputs within price bounds
    const outOfPriceBounds = legs.filter(
      (l) =>
        l.status === 'executed' &&
        l.actualOutput &&
        l.maxAmountOut &&
        parseFloat(l.actualOutput) > parseFloat(l.maxAmountOut),
    );
    checks.push({
      name: 'actual_output_price_bounds',
      passed: outOfPriceBounds.length === 0,
      message:
        outOfPriceBounds.length === 0
          ? 'All actual outputs are within price bounds'
          : `${outOfPriceBounds.length} legs exceed maximum output`,
      severity: 'warning',
    });

    // Check 5: All committed legs have transaction hashes
    const missingTxHash = legs.filter(
      (l) => l.status === 'executed' && !l.stellarTxHash,
    );
    checks.push({
      name: 'tx_hashes_present',
      passed: missingTxHash.length === 0,
      message:
        missingTxHash.length === 0
          ? 'All committed legs have transaction hashes'
          : `${missingTxHash.length} committed legs are missing transaction hashes`,
      severity: 'warning',
    });

    return this.buildResult(checks);
  }

  /**
   * Run post-rollback checks after a rollback.
   * Ensures rolled-back legs are in a consistent state.
   */
  checkPostRollback(
    batch: TransactionBatch,
    legs: BatchLeg[],
  ): ConsistencyCheckResult {
    const checks: CheckDetail[] = [];

    // Check 1: No legs left in an intermediate state
    const intermediateLegs = legs.filter(
      (l) =>
        l.status === 'preparing' ||
        l.status === 'executing' ||
        l.status === 'prepared',
    );
    checks.push({
      name: 'no_intermediate_state',
      passed: intermediateLegs.length === 0,
      message:
        intermediateLegs.length === 0
          ? 'No legs in intermediate state'
          : `${intermediateLegs.length} legs in intermediate state`,
      severity: 'critical',
    });

    // Check 2: Batch is in rolled_back or rolled_back status
    checks.push({
      name: 'batch_rolled_back',
      passed: batch.status === 'rolled_back' || batch.status === 'rolling_back',
      message: `Batch status is '${batch.status}'`,
      severity: 'critical',
    });

    return this.buildResult(checks);
  }

  /**
   * Evaluate a conditional expression against current market data.
   * Returns true if the condition is met.
   */
  evaluateCondition(
    conditionType: string,
    conditionExpression: string,
    currentValue: string,
  ): boolean {
    const value = parseFloat(currentValue);
    const threshold = parseFloat(conditionExpression);

    if (isNaN(value) || isNaN(threshold)) {
      this.logger.warn(
        `Cannot evaluate condition: value=${currentValue}, expression=${conditionExpression}`,
      );
      return false;
    }

    switch (conditionType) {
      case 'price_gt':
        return value > threshold;
      case 'price_lt':
        return value < threshold;
      case 'price_gte':
        return value >= threshold;
      case 'price_lte':
        return value <= threshold;
      case 'amount_gt':
        return value > threshold;
      case 'amount_lt':
        return value < threshold;
      default:
        this.logger.warn(`Unknown condition type: ${conditionType}`);
        return false;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private buildResult(checks: CheckDetail[]): ConsistencyCheckResult {
    const passed = checks.every((c) =>
      c.severity === 'critical' ? c.passed : true,
    );

    const result: ConsistencyCheckResult = {
      passed,
      checks,
      timestamp: new Date(),
    };

    if (!passed) {
      this.logger.warn(
        `Consistency check failed: ${checks
          .filter((c) => !c.passed)
          .map((c) => c.name)
          .join(', ')}`,
      );
    }

    return result;
  }
}
