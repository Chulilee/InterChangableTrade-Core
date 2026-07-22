import { Module } from '@nestjs/common';
import { ErrorHandlerService } from './error-handler.service';

@Module({
  providers: [ErrorHandlerService],
  exports: [ErrorHandlerService],
})
export class ErrorHandlerModule {}
