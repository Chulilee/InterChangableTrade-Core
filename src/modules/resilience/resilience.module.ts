import { Module } from '@nestjs/common';
import { ResilienceService } from './resilience.service';
import { PollyModule } from 'polly-ts-nestjs';

@Module({
  imports: [
    PollyModule.register({
      policies: [],
    }),
  ],
  providers: [ResilienceService],
  exports: [ResilienceService],
})
export class ResilienceModule {}
