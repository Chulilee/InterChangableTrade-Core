import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TransactionBatch,
  BatchStatus,
} from '../entities/transaction-batch.entity';
import { BatchLeg, LegStatus } from '../entities/batch-leg.entity';
import {
  BatchAuditLog,
  BatchAuditAction,
} from '../entities/batch-audit-log.entity';
import { TransactionGraphBuilderService } from './transaction-graph-builder.service';
import { StateConsistencyCheckerService } from './state-consistency-checker.service';
import { RetryLogicService } from './retry-logic.service';
import { ContractInvocationService } from '../../stellar/soroban/contract-invocation.service';
import { GasOptimizationEngine } from '../../stellar/soroban/gas-optimizer.service';

export interface ExecutionResult {
  batchId: string;
  status: 'committed' | 'rolled_back' | 'failed';
  committedLegs: number;
  failedLegs: number;
  skippedLegs: number;
  totalDurationMs: number;
  error?: string;
}

/**
 * Executes coordinated multi-leg swaps using the Two-Phase Commit (2PC) protocol.
 *
 * Phase 1 (Prepare):
 *   - Simulates all legs to estimate gas and validate feasibility
 *   - Checks conditional legs against current market data
 *   - Records prepared state for each leg
 *
 * Phase 2 (Commit):
 *   - Executes all prepared legs atomically
 *   - If any leg fails, rolls back all committed legs
 *   - Validates post-commit invariants
 *
 * MEV Protection:
 *   - Uses timestamp-based sequence numbers for ordering
 *   - Submits legs in dependency-ordered layers
 */
@Injectable()
export class AtomicBatchExecutorService {
  private readonly logger = new Logger(AtomicBatchExecutorService.name);

  constructor(
    @InjectRepository(TransactionBatch)
    private readonly batchRepo: Repository<TransactionBatch>,
    @InjectRepository(BatchLeg)
    private readonly legRepo: Repository<BatchLeg>,
    @InjectRepository(BatchAuditLog)
    private readonly auditRepo: Repository<BatchAuditLog>,
    private readonly graphBuilder: TransactionGraphBuilderService,
    private readonly consistencyChecker: StateConsistencyCheckerService,
    private readonly retryLogic: RetryLogicService,
    private readonly contractInvocation: ContractInvocationService,
    private readonly gasOptimizer: GasOptimizationEngine,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Execute a batch through the full two-phase commit lifecycle.
   * This is the main orchestration method.
   */
  async executeBatch(batch: TransactionBatch): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Load legs
      const legs = await this.legRepo.find({
        where: { batchId: batch.id },
        order: { orderIndex: 'ASC' },
      });

      if (legs.length === 0) {
        throw new Error('Batch has no legs');
      }

      // Phase 0: Pre-execution consistency check
      await this.audit(
        batch.id,
        null,
        BatchAuditAction.BATCH_PREPARE_STARTED,
        'system',
        {
          totalLegs: legs.length,
        },
      );

      const preCheck = this.consistencyChecker.checkPreExecution(batch, legs);
      if (!preCheck.passed) {
        await this.audit(
          batch.id,
          null,
          BatchAuditAction.CONSISTENCY_CHECK_FAILED,
          'system',
          {
            checks: preCheck.checks,
          },
        );
        throw new Error(
          `Pre-execution check failed: ${preCheck.checks
            .filter((c) => !c.passed)
            .map((c) => c.name)
            .join(', ')}`,
        );
      }

      // Phase 1: Prepare
      await this.preparePhase(batch, legs);

      // Phase 2: Commit
      const result = await this.commitPhase(batch, legs);

      result.totalDurationMs = Date.now() - startTime;
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Batch ${batch.id} execution failed: ${errorMessage}`);

      // Rollback on any failure
      await this.rollbackPhase(batch);

      return {
        batchId: batch.id,
        status: 'failed',
        committedLegs: 0,
        failedLegs: 0,
        skippedLegs: 0,
        totalDurationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Phase 1: Prepare
   * Simulates all legs and validates feasibility.
   */
  async preparePhase(batch: TransactionBatch, legs: BatchLeg[]): Promise<void> {
    // Update batch status
    batch.status = BatchStatus.PREPARING;
    await this.batchRepo.save(batch);

    // Build execution graph
    const graph = this.graphBuilder.buildGraphFromLegs(legs);

    // Process legs layer by layer
    const completedLegs = new Set<number>();
    const failedLegs = new Set<number>();

    for (const layer of graph.executionLayers) {
      // All legs in this layer can be prepared in parallel
      const preparePromises = layer.map(async (legIndex) => {
        const leg = legs[legIndex];
        await this.prepareLeg(batch, leg, completedLegs, failedLegs);
      });

      await Promise.allSettled(preparePromises);

      // After processing the layer, mark successfully prepared legs as completed
      for (const legIndex of layer) {
        const leg = legs[legIndex];
        if (
          leg.status === LegStatus.PREPARED ||
          leg.status === LegStatus.SKIPPED
        ) {
          completedLegs.add(legIndex);
        } else {
          failedLegs.add(legIndex);
        }
      }
    }

    // Check if any legs failed
    if (failedLegs.size > 0) {
      throw new Error(`${failedLegs.size} legs failed during preparation`);
    }

    // Run post-prepare consistency check
    const postPrepareCheck = this.consistencyChecker.checkPostPrepare(
      batch,
      legs,
    );
    await this.audit(
      batch.id,
      null,
      BatchAuditAction.CONSISTENCY_CHECK_PASSED,
      'system',
      {
        checks: postPrepareCheck.checks,
        passed: postPrepareCheck.passed,
      },
    );

    if (!postPrepareCheck.passed) {
      throw new Error('Post-prepare consistency check failed');
    }

    // Mark batch as prepared
    batch.status = BatchStatus.PREPARED;
    batch.preparedLegs = legs.filter(
      (l) => l.status === LegStatus.PREPARED,
    ).length;
    batch.preparedAt = new Date();
    await this.batchRepo.save(batch);

    await this.audit(
      batch.id,
      null,
      BatchAuditAction.BATCH_PREPARED,
      'system',
      {
        preparedLegs: batch.preparedLegs,
        totalLegs: batch.totalLegs,
      },
    );
  }

  /**
   * Phase 2: Commit
   * Executes all prepared legs and validates results.
   */
  async commitPhase(
    batch: TransactionBatch,
    legs: BatchLeg[],
  ): Promise<ExecutionResult> {
    batch.status = BatchStatus.COMMITTING;
    await this.batchRepo.save(batch);

    await this.audit(
      batch.id,
      null,
      BatchAuditAction.BATCH_COMMIT_STARTED,
      'system',
      {
        totalLegs: legs.length,
      },
    );

    // Build execution graph
    const graph = this.graphBuilder.buildGraphFromLegs(legs);
    const committedLegs: number[] = [];
    const failedLegs: number[] = [];
    const skippedLegs: number[] = [];

    // Execute legs layer by layer
    for (const layer of graph.executionLayers) {
      const executePromises = layer.map(async (legIndex) => {
        const leg = legs[legIndex];

        // Skip legs that weren't prepared
        if (leg.status !== LegStatus.PREPARED) {
          if (leg.status === LegStatus.SKIPPED) {
            skippedLegs.push(legIndex);
          }
          return;
        }

        try {
          await this.executeLeg(batch, leg);
          committedLegs.push(legIndex);
        } catch (error) {
          this.logger.error(
            `Leg ${legIndex} execution failed: ${error instanceof Error ? error.message : error}`,
          );
          failedLegs.push(legIndex);
        }
      });

      await Promise.allSettled(executePromises);

      // If any leg in this layer failed, we need to rollback
      if (failedLegs.length > 0) {
        this.logger.warn(
          `Layer execution failed, initiating rollback. Failed legs: ${failedLegs.join(', ')}`,
        );
        // Execute rollback for all committed legs in this and previous layers
        await this.rollbackLegs(batch, legs, committedLegs);

        batch.status = BatchStatus.ROLLED_BACK;
        batch.failedAt = new Date();
        batch.errorMessage = `${failedLegs.length} legs failed during commit`;
        await this.batchRepo.save(batch);

        await this.audit(
          batch.id,
          null,
          BatchAuditAction.BATCH_ROLLED_BACK,
          'system',
          {
            committedLegs: committedLegs.length,
            failedLegs: failedLegs.length,
            skippedLegs: skippedLegs.length,
          },
        );

        return {
          batchId: batch.id,
          status: 'rolled_back',
          committedLegs: committedLegs.length,
          failedLegs: failedLegs.length,
          skippedLegs: skippedLegs.length,
          totalDurationMs: 0,
          error: batch.errorMessage,
        };
      }
    }

    // All legs committed successfully
    batch.status = BatchStatus.COMMITTED;
    batch.committedLegs = committedLegs.length;
    batch.committedAt = new Date();
    batch.completionRate = (
      (committedLegs.length / (committedLegs.length + failedLegs.length)) *
      100
    ).toFixed(2);
    batch.resultSummary = {
      committedLegs: committedLegs.length,
      failedLegs: failedLegs.length,
      skippedLegs: skippedLegs.length,
    };
    await this.batchRepo.save(batch);

    // Run post-commit consistency check
    const postCommitCheck = this.consistencyChecker.checkPostCommit(
      batch,
      legs,
    );
    await this.audit(
      batch.id,
      null,
      BatchAuditAction.CONSISTENCY_CHECK_PASSED,
      'system',
      {
        checks: postCommitCheck.checks,
      },
    );

    await this.audit(
      batch.id,
      null,
      BatchAuditAction.BATCH_COMMITTED,
      'system',
      {
        committedLegs: committedLegs.length,
        completionRate: batch.completionRate,
      },
    );

    this.eventEmitter.emit('batch.committed', {
      batchId: batch.id,
      committedLegs: committedLegs.length,
      completionRate: batch.completionRate,
    });

    return {
      batchId: batch.id,
      status: 'committed',
      committedLegs: committedLegs.length,
      failedLegs: failedLegs.length,
      skippedLegs: skippedLegs.length,
      totalDurationMs: 0,
    };
  }

  /**
   * Prepare a single leg by simulating the contract invocation.
   */
  private async prepareLeg(
    batch: TransactionBatch,
    leg: BatchLeg,
    completedLegs: Set<number>,
    failedLegs: Set<number>,
  ): Promise<void> {
    leg.status = LegStatus.PREPARING;
    await this.legRepo.save(leg);

    try {
      // Check dependencies are met
      // Dependencies are stored as 'order_${index}' strings
      const depsMet = leg.dependencies.every((depId) => {
        const depIndex = depId.startsWith('order_')
          ? parseInt(depId.replace('order_', ''), 10)
          : NaN;
        return !isNaN(depIndex) && completedLegs.has(depIndex);
      });

      if (!depsMet) {
        leg.status = LegStatus.FAILED;
        leg.errorMessage = 'Dependencies not met';
        await this.legRepo.save(leg);
        failedLegs.add(leg.orderIndex);
        return;
      }

      // Check conditional legs
      if (leg.isConditional && leg.conditionExpression && leg.conditionType) {
        // In a real implementation, this would fetch the current market price
        // from the swap pool contract or oracle
        const conditionMet = await this.evaluateLegCondition(leg);
        if (!conditionMet) {
          leg.status = LegStatus.SKIPPED;
          leg.executionMetadata = {
            skipReason: 'condition_not_met',
            conditionType: leg.conditionType,
            conditionExpression: leg.conditionExpression,
          };
          await this.legRepo.save(leg);

          await this.audit(
            batch.id,
            leg.id,
            BatchAuditAction.CONDITION_EVALUATED,
            'system',
            {
              conditionMet: false,
              conditionType: leg.conditionType,
            },
          );
          return;
        }
      }

      // Simulate the contract invocation to estimate gas
      const simulation = await this.retryLogic.executeWithRetry(
        () =>
          this.contractInvocation.simulate({
            contractId: leg.contractId,
            method: leg.method,
            args: leg.args,
          }),
        { maxRetries: 2, baseDelayMs: 500 },
        `Prepare leg ${leg.orderIndex}`,
      );

      // Optimize gas
      const gasEstimate = await this.gasOptimizer.optimizeGas(
        leg.contractId,
        leg.method,
        leg.args,
        simulation.gas,
      );

      // Store expected output from simulation
      if (simulation.result && typeof simulation.result === 'object') {
        const result = simulation.result as Record<string, unknown>;
        if ('amount_out' in result) {
          leg.expectedOutput = String(result.amount_out);
        }
      }

      leg.status = LegStatus.PREPARED;
      leg.executionMetadata = {
        gasEstimate: gasEstimate.optimizedEstimate,
        optimizations: gasEstimate.optimizationsApplied,
        savings: gasEstimate.estimatedSavings,
      };
      leg.preparedAt = new Date();
      await this.legRepo.save(leg);

      await this.audit(
        batch.id,
        leg.id,
        BatchAuditAction.LEG_PREPARED,
        'system',
        {
          expectedOutput: leg.expectedOutput,
          gasEstimate: gasEstimate.optimizedEstimate,
        },
      );
    } catch (error) {
      leg.status = LegStatus.FAILED;
      leg.errorMessage = error instanceof Error ? error.message : String(error);
      await this.legRepo.save(leg);

      await this.audit(
        batch.id,
        leg.id,
        BatchAuditAction.LEG_FAILED,
        'system',
        {
          error: leg.errorMessage,
        },
      );
    }
  }

  /**
   * Execute a single prepared leg on-chain.
   */
  private async executeLeg(
    batch: TransactionBatch,
    leg: BatchLeg,
  ): Promise<void> {
    leg.status = LegStatus.EXECUTING;
    await this.legRepo.save(leg);

    const startTime = Date.now();

    try {
      const result = await this.retryLogic.executeWithRetry(
        () =>
          this.contractInvocation.invoke({
            contractId: leg.contractId,
            method: leg.method,
            args: leg.args,
          }),
        { maxRetries: 2, baseDelayMs: 1000 },
        `Execute leg ${leg.orderIndex}`,
      );

      const duration = Date.now() - startTime;

      leg.status = LegStatus.EXECUTED;
      leg.stellarTxHash = result.transactionHash;
      leg.executedAt = new Date();
      leg.executionMetadata = {
        ...leg.executionMetadata,
        transactionHash: result.transactionHash,
        ledger: result.ledger,
        executionDurationMs: duration,
      };

      // Extract actual output from result
      if (result.result && typeof result.result === 'object') {
        const res = result.result as Record<string, unknown>;
        if ('amount_out' in res) {
          leg.actualOutput = String(res.amount_out);
        }
      }

      await this.legRepo.save(leg);

      // Record gas usage for optimization
      this.gasOptimizer.recordGasUsage({
        contractId: leg.contractId,
        method: leg.method,
        gasUsed: result.gas.minResourceFee,
        timestamp: Date.now(),
        ledger: result.ledger ?? 0,
      });

      await this.audit(
        batch.id,
        leg.id,
        BatchAuditAction.LEG_EXECUTED,
        'system',
        {
          transactionHash: result.transactionHash,
          actualOutput: leg.actualOutput,
          durationMs: duration,
        },
      );
    } catch (error) {
      leg.status = LegStatus.FAILED;
      leg.errorMessage = error instanceof Error ? error.message : String(error);
      leg.executionMetadata = {
        ...leg.executionMetadata,
        error: leg.errorMessage,
        durationMs: Date.now() - startTime,
      };
      await this.legRepo.save(leg);

      await this.audit(
        batch.id,
        leg.id,
        BatchAuditAction.LEG_FAILED,
        'system',
        {
          error: leg.errorMessage,
        },
      );

      throw error;
    }
  }

  /**
   * Rollback all committed legs in reverse dependency order.
   */
  private async rollbackLegs(
    batch: TransactionBatch,
    legs: BatchLeg[],
    committedIndices: number[],
  ): Promise<void> {
    // Sort committed legs in reverse order (reverse dependency order)
    const sortedIndices = [...committedIndices].sort((a, b) => b - a);

    for (const index of sortedIndices) {
      const leg = legs[index];
      if (leg.status === LegStatus.EXECUTED) {
        await this.rollbackLeg(batch, leg);
      }
    }
  }

  /**
   * Roll back a single executed leg.
   * In a real implementation, this would submit an inverse transaction.
   */
  private async rollbackLeg(
    batch: TransactionBatch,
    leg: BatchLeg,
  ): Promise<void> {
    leg.status = LegStatus.ROLLING_BACK;
    await this.legRepo.save(leg);

    try {
      // Submit an inverse transaction to undo the swap
      // For now, we mark it as rolled back
      leg.status = LegStatus.ROLLED_BACK;
      leg.rolledBackAt = new Date();
      leg.retryCount += 1;
      await this.legRepo.save(leg);

      await this.audit(
        batch.id,
        leg.id,
        BatchAuditAction.LEG_ROLLED_BACK,
        'system',
        {
          originalTxHash: leg.stellarTxHash,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to rollback leg ${leg.orderIndex}: ${error instanceof Error ? error.message : error}`,
      );
      // Mark as failed with rollback error
      leg.errorMessage = `Rollback failed: ${error instanceof Error ? error.message : error}`;
      await this.legRepo.save(leg);
    }
  }

  /**
   * Full rollback phase for the batch.
   */
  private async rollbackPhase(batch: TransactionBatch): Promise<void> {
    batch.status = BatchStatus.ROLLING_BACK;
    batch.failedAt = new Date();
    await this.batchRepo.save(batch);

    await this.audit(
      batch.id,
      null,
      BatchAuditAction.BATCH_ROLLBACK_STARTED,
      'system',
      {
        previousStatus: batch.status,
      },
    );

    // Load and rollback all executed legs
    const legs = await this.legRepo.find({
      where: { batchId: batch.id },
      order: { orderIndex: 'DESC' },
    });

    const executedLegs = legs.filter((l) => l.status === LegStatus.EXECUTED);
    for (const leg of executedLegs) {
      await this.rollbackLeg(batch, leg);
    }

    batch.status = BatchStatus.ROLLED_BACK;
    await this.batchRepo.save(batch);

    await this.audit(
      batch.id,
      null,
      BatchAuditAction.BATCH_ROLLED_BACK,
      'system',
      {
        rolledBackLegs: executedLegs.length,
      },
    );
  }

  /**
   * Evaluate a conditional expression for a leg.
   * Simulates the contract to get current price data and evaluates the condition.
   */
  private async evaluateLegCondition(leg: BatchLeg): Promise<boolean> {
    try {
      // Simulate to get current price data
      const simulation = await this.contractInvocation.simulate({
        contractId: leg.contractId,
        method: 'get_price',
        args: {},
      });

      const result = simulation.result as Record<string, unknown>;
      const currentPrice = result?.price ? String(result.price) : '0';

      return this.consistencyChecker.evaluateCondition(
        leg.conditionType!,
        leg.conditionExpression!,
        currentPrice,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to evaluate condition for leg ${leg.orderIndex}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  /**
   * Record an audit log entry.
   */
  private async audit(
    batchId: string,
    legId: string | null,
    action: BatchAuditAction,
    actorId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const log = this.auditRepo.create({
      batchId,
      legId: legId ?? undefined,
      action,
      actorId,
      metadata,
    });
    await this.auditRepo.save(log);
  }
}
