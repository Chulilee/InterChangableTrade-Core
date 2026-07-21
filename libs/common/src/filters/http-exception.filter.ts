import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorHandlerService } from 'src/modules/error-handler/error-handler.service';

/**
 * Normalizes error responses into the same envelope style used for success
 * responses, and logs unexpected (non-HTTP) errors for diagnosis.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly errorHandlerService: ErrorHandlerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const appError = this.errorHandlerService.handle(exception);

    const isProduction = process.env.NODE_ENV === 'production';

    response.status(appError.getStatus()).json({
      success: false,
      statusCode: appError.getStatus(),
      path: request.url,
      error: isProduction
        ? { message: 'An unexpected error occurred.' }
        : appError.toDetail(),
      timestamp: new Date().toISOString(),
    });
  }
}
