import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { StellarModule } from '../stellar/stellar.module';
import { RedisModule } from '../../redis/redis.module';
import { BlockchainIndexerController } from './blockchain-indexer.controller';
import { BlockchainIndexerService } from './blockchain-indexer.service';
import { BlockchainEvent } from './entities/blockchain-event.entity';
import { IndexerState } from './entities/indexer-state.entity';
import { IndexedEvent } from './entities/indexed-event.entity';
import { StellarEventSourceService } from './services/stellar-event-source.service';
import { IndexingStateService } from './services/indexing-state.service';
import { ReorgHandlerService } from './services/reorg-handler.service';
import { EventIndexerService } from './services/event-indexer.service';
import { EventQueryService } from './services/event-query.service';
import { EventStreamService } from './services/event-stream.service';
// New real-time indexing services
import { HorizonStreamService } from './services/horizon-stream.service';
import { EventNormalizer } from './services/event-normalizer.service';
import { EventBufferService } from './services/event-buffer.service';
import { BatchedPersistenceService } from './services/batched-persistence.service';
import { SubscriptionManager } from './services/subscription-manager.service';
import { LedgerIndexerService } from './services/ledger-indexer.service';
import { EventWebSocketGateway } from './event-websocket.gateway';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BlockchainEvent, IndexerState, IndexedEvent]),
    StellarModule,
    RedisModule,
  ],
  controllers: [BlockchainIndexerController],
  providers: [
    // Legacy polling-based indexer (kept for backward compatibility)
    BlockchainIndexerService,
    StellarEventSourceService,
    IndexingStateService,
    ReorgHandlerService,
    EventIndexerService,
    EventQueryService,
    EventStreamService,
    // Real-time streaming indexer
    HorizonStreamService,
    EventNormalizer,
    EventBufferService,
    BatchedPersistenceService,
    SubscriptionManager,
    LedgerIndexerService,
    EventWebSocketGateway,
  ],
  exports: [
    BlockchainIndexerService,
    LedgerIndexerService,
    SubscriptionManager,
  ],
})
export class BlockchainIndexerModule {}
