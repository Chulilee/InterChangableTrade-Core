import { Injectable, Logger } from '@nestjs/common';
import { AppError, UnknownError } from './errors';
import { DlqService } from '../queue/dlq.service';

@Injectable()
export class ErrorHandlerService {
  private readonly logger = new Logger(ErrorHandlerService.name);

  constructor(private readonly dlqService: DlqService) {}

  handle(error: unknown): AppError {
    if (error instanceof AppError) {
      this.logger.error(
        `[${error.category}] ${error.message}`,
        error.stack,
        error.details,
      );
      return error;
    }

    const unknownError = new UnknownError('An unexpected error occurred', {
      cause: error,
    });
    this.logger.error(
      `[${unknownError.category}] ${unknownError.message}`,
      error instanceof Error ? error.stack : String(error),
    );

    // Add the error to the dead-letter queue
    this.dlqService.add(
      { originalError: error },
      error instanceof Error ? error : new Error(String(error)),
    );

    return unknownError;
  }
}
