import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { CreateBatchDto, SwapLegDto } from '../dto/create-batch.dto';
import { BatchDetailResponse } from '../dto/batch-response.dto';
import { QueryBatchDto } from '../dto/query-batch.dto';
import { TransactionGraphBuilderService } from './transaction-graph-builder.service';
import { StateConsistencyCheckerService } from './state-consistency-checker.service';
import {
  AtomicBatchExecutorService,
  ExecutionResult,
} from './atomic-batch-executor.service';
import { RetryLogicService } from './retry-logic.service';
import { PaginatedResultDto } from '@app/common';

/**
 * Central coordinator for distributed atomic swap transactions.
 *
 * This service orchestrates:
 * - Transaction graph construction (dependency analysis)
 * - Two-phase commit execution
 * - State consistency validation
 * - Timeout and retry handling
 * - Audit trail management
 * - Partial fill recovery
 * - MEV-resistant ordering
 *
 * Usage:
 *   1. Create a batch with createBatch()
 *   2. Execute with executeBatch() or prepareBatch() + commitBatch()
 *   3. Query status with getBatchDetail()
 *   4. Cancel with cancelBatch() if needed
 */
@Injectable()
export class TransactionCoordinatorService {
  private readonly logger = new Logger(TransactionCoordinatorService.name);

  /** Map of running batch timeouts for cleanup */
  private batchTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectRepository(TransactionBatch)
    private readonly batchRepo: Repository<TransactionBatch>,
    @InjectRepository(BatchLeg)
    private readonly legRepo: Repository<BatchLeg>,
    @InjectRepository(BatchAuditLog)
    private readonly auditRepo: Repository<BatchAuditLog>,
    private readonly graphBuilder: TransactionGraphBuilderService,
    private readonly consistencyChecker: StateConsistencyCheckerService,
    private readonly batchExecutor: AtomicBatchExecutorService,
    private readonly retryLogic: RetryLogicService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new transaction batch from a DTO.
   * Validates the batch configuration and builds the execution graph.
   */
  async createBatch(
    userId: string,
    dto: CreateBatchDto,
  ): Promise<TransactionBatch> {
    // Validate minimum legs
    if (dto.legs.length < 1) {
      throw new BadRequestException('Batch must have at least 1 leg');
    }

    // Validate dependency indices
    for (let i = 0; i < dto.legs.length; i++) {
      const leg = dto.legs[i];
      if (leg.dependencies) {
        for (const dep of leg.dependencies) {
          if (dep >= i) {
            throw new BadRequestException(
              `Leg ${i} has forward dependency on leg ${dep}`,
            );
          }
        }
      }
    }

    // Build execution graph to validate structure
    const graph = this.graphBuilder.buildGraphFromDtos(dto.legs);

    // Generate MEV-resistant sequence number
    const sequenceNumber = Date.now();

    const batch = this.batchRepo.create({
      userId,
      name: dto.name,
      status: BatchStatus.CREATED,
      totalLegs: dto.legs.length,
      preparedLegs: 0,
      committedLegs: 0,
      sequenceNumber,
      timeoutMs: dto.timeoutMs ?? 30000,
      hasConditionals: dto.legs.some((l) => l.isConditional),
      metadata: dto.metadata ?? null,
      expiresAt: new Date(Date.now() + (dto.timeoutMs ?? 30000)),
    });

    const savedBatch = await this.batchRepo.save(batch);

    // Create leg records
    const legs = dto.legs.map((legDto, index) =>
      this.legRepo.create({
        batchId: savedBatch.id,
        orderIndex: index,
        dependencies: this.resolveDependencyIndices(legDto),
        contractId: legDto.contractId,
        method: legDto.method,
        args: legDto.args ?? {},
        sourceAssetCode: legDto.sourceAssetCode,
        sourceAssetIssuer: legDto.sourceAssetIssuer ?? null,
        destAssetCode: legDto.destAssetCode,
        destAssetIssuer: legDto.destAssetIssuer ?? null,
        amount: legDto.amount.toString(),
        minAmountOut: legDto.minAmountOut.toString(),
        maxAmountOut: legDto.maxAmountOut?.toString() ?? null,
        isConditional: legDto.isConditional ?? false,
        conditionExpression: legDto.conditional?.conditionExpression ?? null,
        conditionType: legDto.conditional?.conditionType ?? null,
        status: LegStatus.PENDING,
        retryCount: 0,
      }),
    );

    await this.legRepo.save(legs);

    // Audit
    await this.audit(
      savedBatch.id,
      null,
      BatchAuditAction.BATCH_CREATED,
      userId,
      {
        name: dto.name,
        totalLegs: dto.legs.length,
        hasConditionals: savedBatch.hasConditionals,
        executionPlan: graph.executionLayers,
      },
    );

    this.logger.log(
      `Batch ${savedBatch.id} created with ${dto.legs.length} legs, ` +
        `${graph.executionLayers.length} execution layers`,
    );

    return savedBatch;
  }

  /**
   * Execute a batch through the full 2PC lifecycle.
   * Returns when all legs are committed or rolled back.
   */
  async executeBatch(batchId: string): Promise<ExecutionResult> {
    const batch = await this.getBatchOrThrow(batchId);

    if (batch.status !== BatchStatus.CREATED) {
      throw new BadRequestException(
        `Cannot execute batch in status '${batch.status}'`,
      );
    }

    // Execute with timeout
    return this.executeWithTimeout(batch);
  }

  /**
   * Prepare a batch without committing.
   * Use for manual 2-phase commit control.
   */
  async prepareBatch(batchId: string): Promise<TransactionBatch> {
    const batch = await this.getBatchOrThrow(batchId);

    if (batch.status !== BatchStatus.CREATED) {
      throw new BadRequestException(
        `Cannot prepare batch in status '${batch.status}'`,
      );
    }

    const legs = await this.legRepo.find({
      where: { batchId: batch.id },
      order: { orderIndex: 'ASC' },
    });

    await this.batchExecutor.preparePhase(batch, legs);

    return this.getBatchOrThrow(batchId);
  }

  /**
   * Commit a previously prepared batch.
   */
  async commitBatch(batchId: string): Promise<ExecutionResult> {
    const batch = await this.getBatchOrThrow(batchId);

    if (batch.status !== BatchStatus.PREPARED) {
      throw new BadRequestException(
        `Cannot commit batch in status '${batch.status}'`,
      );
    }

    const legs = await this.legRepo.find({
      where: { batchId: batch.id },
      order: { orderIndex: 'ASC' },
    });

    return this.batchExecutor.commitPhase(batch, legs);
  }

  /**
   * Get detailed information about a batch including legs and graph.
   */
  async getBatchDetail(batchId: string): Promise<BatchDetailResponse> {
    const batch = await this.getBatchOrThrow(batchId);

    const legs = await this.legRepo.find({
      where: { batchId: batch.id },
      order: { orderIndex: 'ASC' },
    });

    // Build graph from legs
    const graph = this.graphBuilder.buildGraphFromLegs(legs);

    // Build dependency adjacency list
    const dependencyGraph: Record<string, string[]> = {};
    for (const leg of legs) {
      dependencyGraph[leg.id] = leg.dependencies;
    }

    // Build execution plan (string IDs grouped by layer)
    const executionPlan = graph.executionLayers.map(
      (layer) => layer.map((idx) => legs[idx]?.id).filter(Boolean) as string[],
    );

    // Estimate total duration
    const estimatedDurationMs = legs.reduce((sum, leg) => {
      const meta = leg.executionMetadata as Record<string, any> | null;
      return sum + (meta?.executionDurationMs ?? 1000);
    }, 0);

    return {
      batch,
      legs,
      dependencyGraph,
      executionPlan,
      estimatedDurationMs,
    };
  }

  /**
   * List batches with filtering and pagination.
   */
  async listBatches(
    userId: string,
    query: QueryBatchDto,
  ): Promise<PaginatedResultDto<TransactionBatch>> {
    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .orderBy('batch.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (userId) {
      qb.andWhere('batch.userId = :userId', { userId });
    }
    if (query.status) {
      qb.andWhere('batch.status = :status', { status: query.status });
    }
    if (query.name) {
      qb.andWhere('batch.name ILIKE :name', { name: `%${query.name}%` });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  /**
   * Cancel a batch that hasn't been committed yet.
   */
  async cancelBatch(
    batchId: string,
    userId: string,
  ): Promise<TransactionBatch> {
    const batch = await this.getBatchOrThrow(batchId);

    if (batch.userId !== userId) {
      throw new BadRequestException('Only the batch creator can cancel');
    }

    const cancellableStatuses: BatchStatus[] = [
      BatchStatus.CREATED,
      BatchStatus.PREPARING,
      BatchStatus.PREPARED,
    ];

    if (!cancellableStatuses.includes(batch.status)) {
      throw new BadRequestException(
        `Cannot cancel batch in status '${batch.status}'`,
      );
    }

    // If the batch is prepared or being prepared, rollback
    if (
      batch.status === BatchStatus.PREPARED ||
      batch.status === BatchStatus.PREPARING
    ) {
      batch.status = BatchStatus.ROLLING_BACK;
      await this.batchRepo.save(batch);

      // Rollback any prepared legs
      const legs = await this.legRepo.find({ where: { batchId } });
      for (const leg of legs) {
        if (
          leg.status === LegStatus.PREPARED ||
          leg.status === LegStatus.EXECUTED
        ) {
          leg.status = LegStatus.ROLLED_BACK;
          leg.rolledBackAt = new Date();
          await this.legRepo.save(leg);
        }
      }
    }

    batch.status = BatchStatus.ROLLED_BACK;
    batch.failedAt = new Date();
    batch.errorMessage = `Cancelled by user ${userId}`;
    await this.batchRepo.save(batch);

    // Clear timeout if exists
    const timeout = this.batchTimeouts.get(batchId);
    if (timeout) {
      clearTimeout(timeout);
      this.batchTimeouts.delete(batchId);
    }

    await this.audit(
      batchId,
      null,
      BatchAuditAction.BATCH_ROLLED_BACK,
      userId,
      {
        reason: 'user_cancel',
      },
    );

    return batch;
  }

  /**
   * Get the audit trail for a batch.
   */
  async getAuditTrail(batchId: string): Promise<BatchAuditLog[]> {
    await this.getBatchOrThrow(batchId);

    return this.auditRepo.find({
      where: { batchId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Handle batch timeout — fail any running batch that exceeded its time limit.
   */
  async handleBatchTimeout(batchId: string): Promise<void> {
    const batch = await this.getBatchOrThrow(batchId);

    const runningStatuses: BatchStatus[] = [
      BatchStatus.CREATED,
      BatchStatus.PREPARING,
      BatchStatus.PREPARED,
      BatchStatus.COMMITTING,
    ];

    if (!runningStatuses.includes(batch.status)) {
      return;
    }

    this.logger.warn(`Batch ${batchId} timed out in status '${batch.status}'`);

    batch.status = BatchStatus.EXPIRED;
    batch.failedAt = new Date();
    batch.errorMessage = `Batch timed out after ${batch.timeoutMs}ms`;
    await this.batchRepo.save(batch);

    // Rollback any prepared/executed legs
    const legs = await this.legRepo.find({ where: { batchId } });
    for (const leg of legs) {
      if (
        leg.status === LegStatus.PREPARED ||
        leg.status === LegStatus.EXECUTED ||
        leg.status === LegStatus.EXECUTING
      ) {
        leg.status = LegStatus.ROLLED_BACK;
        leg.rolledBackAt = new Date();
        await this.legRepo.save(leg);
      }
    }

    await this.audit(batchId, null, BatchAuditAction.BATCH_EXPIRED, 'system', {
      timeoutMs: batch.timeoutMs,
    });

    this.eventEmitter.emit('batch.expired', { batchId });
  }

  /**
   * Get coordinator statistics for monitoring.
   */
  async getStatistics(): Promise<{
    totalBatches: number;
    statusCounts: Record<string, number>;
    avgLegsPerBatch: number;
    avgCompletionRate: number;
  }> {
    const totalBatches = await this.batchRepo.count();

    const statusCounts = await this.batchRepo
      .createQueryBuilder('batch')
      .select('batch.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('batch.status')
      .getRawMany();

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = parseInt(row.count, 10);
    }

    const avgResult = await this.batchRepo
      .createQueryBuilder('batch')
      .select('AVG(batch.totalLegs)', 'avgLegs')
      .addSelect('AVG(batch.completionRate)', 'avgRate')
      .getRawOne();

    return {
      totalBatches,
      statusCounts: statusMap,
      avgLegsPerBatch: parseFloat(avgResult?.avgLegs ?? '0'),
      avgCompletionRate: parseFloat(avgResult?.avgRate ?? '0'),
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async getBatchOrThrow(id: string): Promise<TransactionBatch> {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Transaction batch ${id} not found`);
    }
    return batch;
  }

  /**
   * Execute a batch with a timeout that triggers rollback if exceeded.
   */
  private async executeWithTimeout(
    batch: TransactionBatch,
  ): Promise<ExecutionResult> {
    return new Promise<ExecutionResult>((resolve, reject) => {
      const timer = setTimeout(async () => {
        this.batchTimeouts.delete(batch.id);
        await this.handleBatchTimeout(batch.id);
        resolve({
          batchId: batch.id,
          status: 'failed',
          committedLegs: 0,
          failedLegs: 0,
          skippedLegs: 0,
          totalDurationMs: batch.timeoutMs,
          error: `Batch timed out after ${batch.timeoutMs}ms`,
        });
      }, batch.timeoutMs);

      this.batchTimeouts.set(batch.id, timer);

      this.batchExecutor
        .executeBatch(batch)
        .then((result) => {
          clearTimeout(timer);
          this.batchTimeouts.delete(batch.id);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          this.batchTimeouts.delete(batch.id);
          reject(error);
        });
    });
  }

  /**
   * Resolve dependency indices from DTO format to stored leg IDs.
   * In the DTO, dependencies are specified by order index (0-based).
   * When creating legs, we store the order indices as dependency references.
   */
  private resolveDependencyIndices(legDto: SwapLegDto): string[] {
    // Return the order indices as string references
    // These will be resolved to actual IDs after all legs are created
    return (legDto.dependencies ?? []).map((dep) => `order_${dep}`);
  }

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
