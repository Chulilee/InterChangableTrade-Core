import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { DatabaseConfig } from './config/database.config';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AssetsModule } from './modules/assets/assets.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { TradingEngineModule } from './modules/trading-engine/trading-engine.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { TradingModule } from './modules/trading/trading.module';
import { BlockchainIndexerModule } from './modules/blockchain-indexer/blockchain-indexer.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      useClass: DatabaseConfig,
    }),
    RedisModule,
    UsersModule,
    AuthModule,
    MarketplaceModule,
    AssetsModule,
    TransactionsModule,
    StellarModule,
    TradingEngineModule,
    WalletModule,
    TradingModule,
    BlockchainIndexerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
