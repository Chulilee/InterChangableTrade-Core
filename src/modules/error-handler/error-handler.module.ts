import { Module } from '@nestjs/common';
import { ErrorHandlerService } from './error-handler.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [ErrorHandlerService],
  exports: [ErrorHandlerService],
})
export class ErrorHandlerModule {}
