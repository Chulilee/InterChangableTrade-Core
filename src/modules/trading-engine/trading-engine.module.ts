import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { Trade } from './entities/trade.entity';
import { AuditTrail } from './entities/audit-trail.entity';
import { TradingEngineService } from './trading-engine.service';
import { TradingEngineController } from './trading-engine.controller';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Trade, AuditTrail]),
    StellarModule,
  ],
  controllers: [TradingEngineController],
  providers: [TradingEngineService],
  exports: [TradingEngineService],
})
export class TradingEngineModule {}
