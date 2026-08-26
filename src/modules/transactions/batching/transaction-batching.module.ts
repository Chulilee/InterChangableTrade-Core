import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../entities/transaction.entity';
import { BatchingController } from './batching.controller';
import { BatchingScheduler } from './batching.scheduler';
import { BatchingService } from './batching.service';
import { SettlementBatch } from './entities/settlement-batch.entity';
import { NetSettlementService } from './net-settlement.service';
import {
  SETTLEMENT_EXECUTOR,
  StellarSettlementExecutor,
} from './settlement-executor';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, SettlementBatch])],
  controllers: [BatchingController],
  providers: [
    BatchingService,
    BatchingScheduler,
    NetSettlementService,
    { provide: SETTLEMENT_EXECUTOR, useClass: StellarSettlementExecutor },
  ],
  exports: [BatchingService],
})
export class TransactionBatchingModule {}
