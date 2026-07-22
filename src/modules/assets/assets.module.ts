import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './entities/asset.entity';
import { AssetsService } from './assets.service';
import { AssetIndexerService } from './asset-indexer.service';
import { AssetsController } from './assets.controller';
import { AuthModule } from '../auth/auth.module';
import { TrustLine } from './entities/trustline.entity';
import { User } from '../users/entities/user.entity';
import { TrustlinesService } from './trustlines.service';
import { TrustlinesController } from './trustlines.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Asset, TrustLine, User]), AuthModule],
  controllers: [AssetsController, TrustlinesController],
  providers: [AssetsService, AssetIndexerService, TrustlinesService],
  exports: [AssetsService, TrustlinesService],
})
export class AssetsModule {}
