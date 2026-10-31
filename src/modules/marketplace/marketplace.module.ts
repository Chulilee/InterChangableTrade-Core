import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Listing } from './entities/listing.entity';
import { Order } from './entities/order.entity';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';
import { OrderMonitoringProcessor } from './order-monitoring.processor';
import { LiquidityAggregatorModule } from '../liquidity-aggregator/liquidity-aggregator.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Listing, Order]),
    BullModule.registerQueue({ name: 'order-monitoring' }),
    LiquidityAggregatorModule,
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, OrderMonitoringProcessor],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
