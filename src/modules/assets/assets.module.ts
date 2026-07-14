import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from './entities/asset.entity';
import { AssetsService } from './assets.service';
import { AssetIndexerService } from './asset-indexer.service';
import { AssetsController } from './assets.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Asset]), AuthModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetIndexerService],
  exports: [AssetsService],
})
export class AssetsModule {}
