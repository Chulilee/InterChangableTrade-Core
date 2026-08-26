import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Transaction, TransactionStatus } from '../entities/transaction.entity';
import {
  BatchStatus,
  BatchTrigger,
  SettlementBatch,
} from './entities/settlement-batch.entity';
import { NetSettlementService } from './net-settlement.service';
import {
  SETTLEMENT_EXECUTOR,
  SettlementExecutor,
  SettlementResult,
} from './settlement-executor';

export interface BatchTriggerStatus {
  pendingCount: number;
  sizeThresholdReached: boolean;
  timeThresholdReached: boolean;
  windowOpenedAt: Date | null;
}

@Injectable()
export class BatchingService {
  private readonly logger = new Logger(BatchingService.name);
  private executing = false;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(SettlementBatch)
    private readonly batchesRepository: Repository<SettlementBatch>,
    private readonly netSettlement: NetSettlementService,
    @Inject(SETTLEMENT_EXECUTOR)
    private readonly executor: SettlementExecutor,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  get batchSizeThreshold(): number {
    return this.configService.get<number>('batching.sizeThreshold') ?? 50;
  }

  get batchWindowMs(): number {
    return this.configService.get<number>('batching.windowMs') ?? 30_000;
  }

  /**
   * Loads the currently pending transactions that are eligible for batching
   * and reports whether any trigger condition is met.
   */
  async evaluateTriggers(now = new Date()): Promise<BatchTriggerStatus> {
    const eligible = await this.loadEligible();
    if (eligible.length === 0) {
      return {
        pendingCount: 0,
        sizeThresholdReached: false,
        timeThresholdReached: false,
        windowOpenedAt: null,
      };
    }

    const oldest = eligible.reduce(
      (min, tx) => (tx.createdAt < min ? tx.createdAt : min),
      eligible[0].createdAt,
    );
    return {
      pendingCount: eligible.length,
      sizeThresholdReached: eligible.length >= this.batchSizeThreshold,
      timeThresholdReached:
        now.getTime() - oldest.getTime() >= this.batchWindowMs,
      windowOpenedAt: oldest,
    };
  }

  /**
   * Timer entry point: executes a batch whenever the size or time trigger
   * fires. Safe to call concurrently — re-entrant calls are dropped.
   */
  async onTick(now = new Date()): Promise<SettlementBatch | null> {
    const status = await this.evaluateTriggers(now);
    if (!status.sizeThresholdReached && !status.timeThresholdReached) {
      return null;
    }
    return this.executeBatch(
      status.sizeThresholdReached ? BatchTrigger.SIZE : BatchTrigger.TIME,
      now,
    );
  }

  /** Manual trigger for urgent settlements — ignores both thresholds. */
  async triggerManual(): Promise<SettlementBatch> {
    const batch = await this.executeBatch(BatchTrigger.MANUAL);
    if (!batch) {
      throw new NotFoundException('No pending transactions to batch');
    }
    return batch;
  }

  /**
   * Core settlement workflow:
   *   load → validate composition → create batch row → net settlement →
   *   atomic on-chain execution → finalize members.
   * Any failure rolls the whole thing back and leaves member transactions
   * untouched (still pending), preserving atomicity.
   */
  async executeBatch(
    trigger: BatchTrigger,
    now = new Date(),
  ): Promise<SettlementBatch | null> {
    if (this.executing) {
      this.logger.debug('Batch execution already in progress, skipping tick');
      return null;
    }
    this.executing = true;
    const startedAt = Date.now();

    try {
      const { eligible, rejected } = this.netSettlement.validateComposition(
        await this.loadEligible(),
      );
      if (eligible.length === 0) {
        return null;
      }

      const windowOpenedAt = eligible.reduce(
        (min, tx) => (tx.createdAt < min ? tx.createdAt : min),
        eligible[0].createdAt,
      );

      const batch = await this.batchesRepository.save(
        this.batchesRepository.create({
          trigger,
          status: BatchStatus.EXECUTING,
          transactionCount: eligible.length,
          transactionIds: eligible.map((t) => t.id),
          rejected,
          windowOpenedAt,
        }),
      );

      try {
        const transfers = this.netSettlement.computeNetSettlement(eligible);
        const feeAnalysis = this.netSettlement.analyzeFees(
          eligible.length,
          transfers,
        );

        let result: SettlementResult;
        try {
          result = await this.executor.execute(transfers);
        } catch (error) {
          await this.executor.rollback(transfers);
          throw error;
        }

        const processingMs = Date.now() - startedAt;
        return await this.finalize(batch, eligible, {
          transfers,
          feeAnalysis,
          hash: result.hash,
          ledger: result.ledger,
          processingMs,
          executedAt: new Date(now.getTime() + processingMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Batch ${batch.id} failed atomically, no transactions settled: ${message}`,
        );
        return await this.batchesRepository.save({
          ...batch,
          status: BatchStatus.FAILED,
          failureReason: message.slice(0, 500),
          settlements: [],
          processingMs: Date.now() - startedAt,
          executedAt: new Date(),
        });
      }
    } finally {
      this.executing = false;
    }
  }

  private async finalize(
    batch: SettlementBatch,
    members: Transaction[],
    outcome: {
      transfers: ReturnType<NetSettlementService['computeNetSettlement']>;
      feeAnalysis: ReturnType<NetSettlementService['analyzeFees']>;
      hash: string | null;
      ledger: number | null;
      processingMs: number;
      executedAt: Date;
    },
  ): Promise<SettlementBatch> {
    // Persist settlement results and member status transitions in one DB
    // transaction so a crash can never leave half-updated state behind.
    return this.dataSource.transaction(async (em) => {
      const batchRepo = em.getRepository(SettlementBatch);
      const txRepo = em.getRepository(Transaction);

      await txRepo.update(
        { id: In(members.map((m) => m.id)) },
        {
          status: TransactionStatus.SUCCESS,
          stellarTxHash: outcome.hash,
          ledgerCloseTime: outcome.executedAt,
        },
      );

      return batchRepo.save({
        ...batch,
        status: BatchStatus.SETTLED,
        settlements: outcome.transfers,
        feeAnalysis: outcome.feeAnalysis,
        stellarTxHash: outcome.hash,
        processingMs: outcome.processingMs,
        executedAt: outcome.executedAt,
      });
    });
  }

  async findOne(id: string): Promise<SettlementBatch> {
    const batch = await this.batchesRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Settlement batch ${id} not found`);
    }
    return batch;
  }

  async findHistory(status?: BatchStatus): Promise<SettlementBatch[]> {
    return this.batchesRepository.find({
      where: status ? { status } : undefined,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  private loadEligible(): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      where: { status: TransactionStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: this.batchSizeThreshold,
    });
  }
}
