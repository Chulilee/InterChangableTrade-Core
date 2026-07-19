import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service';
import { SorobanService } from './soroban.service';
import { StellarController } from './stellar.controller';

@Module({
  controllers: [StellarController],
  providers: [StellarService, SorobanService],
  exports: [StellarService, SorobanService],
})
export class StellarModule {}