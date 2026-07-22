import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { StellarModule } from '../stellar/stellar.module';
import { RedisModule } from '../../redis/redis.module';
import { BlockchainIndexerController } from './blockchain-indexer.controller';
import { BlockchainIndexerService } from './blockchain-indexer.service';
import { BlockchainEvent } from './entities/blockchain-event.entity';
import { IndexerState } from './entities/indexer-state.entity';
import { StellarEventSourceService } from './services/stellar-event-source.service';
import { IndexingStateService } from './services/indexing-state.service';
import { ReorgHandlerService } from './services/reorg-handler.service';
import { EventIndexerService } from './services/event-indexer.service';
import { EventQueryService } from './services/event-query.service';
import { EventStreamService } from './services/event-stream.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BlockchainEvent, IndexerState]),
    StellarModule,
    RedisModule,
  ],
  controllers: [BlockchainIndexerController],
  providers: [
    BlockchainIndexerService,
    StellarEventSourceService,
    IndexingStateService,
    ReorgHandlerService,
    EventIndexerService,
    EventQueryService,
    EventStreamService,
  ],
  exports: [BlockchainIndexerService],
})
export class BlockchainIndexerModule {}
