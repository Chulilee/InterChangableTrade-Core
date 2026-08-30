import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TransactionBatch } from './entities/transaction-batch.entity';
import { BatchLeg } from './entities/batch-leg.entity';
import { BatchAuditLog } from './entities/batch-audit-log.entity';
import { TransactionCoordinatorService } from './services/transaction-coordinator.service';
import { AtomicBatchExecutorService } from './services/atomic-batch-executor.service';
import { TransactionGraphBuilderService } from './services/transaction-graph-builder.service';
import { StateConsistencyCheckerService } from './services/state-consistency-checker.service';
import { RetryLogicService } from './services/retry-logic.service';
import { TransactionCoordinatorController } from './transaction-coordinator.controller';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionBatch, BatchLeg, BatchAuditLog]),
    EventEmitterModule,
    StellarModule,
  ],
  controllers: [TransactionCoordinatorController],
  providers: [
    TransactionCoordinatorService,
    AtomicBatchExecutorService,
    TransactionGraphBuilderService,
    StateConsistencyCheckerService,
    RetryLogicService,
  ],
  exports: [
    TransactionCoordinatorService,
    AtomicBatchExecutorService,
    TransactionGraphBuilderService,
    StateConsistencyCheckerService,
    RetryLogicService,
  ],
})
export class TransactionCoordinatorModule {}
