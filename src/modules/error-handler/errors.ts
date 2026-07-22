import { HttpException, HttpStatus } from '@nestjs/common';

export enum ErrorCategory {
  /** Errors originating from external APIs or services. */
  API = 'api',
  /** Errors related to database operations. */
  DATABASE = 'database',
  /** Errors due to invalid input data. */
  VALIDATION = 'validation',
  /** Errors related to business logic. */
  BUSINESS = 'business',
  /** Any other unexpected errors. */
  UNKNOWN = 'unknown',
  /** Errors for testing purposes. */
  TEST = 'test',
}

export interface AppErrorDetails {
  /** The original error, preserved for logging (never serialized to clients). */
  cause?: unknown;
  /** Any additional context to be logged. */
  [key: string]: any;
}

export abstract class AppError extends HttpException {
  abstract readonly category: ErrorCategory;
  readonly details: AppErrorDetails;

  constructor(
    message: string,
    status: HttpStatus,
    details: AppErrorDetails = {},
  ) {
    super(
      {
        message,
        error: message,
      },
      status,
    );
    this.details = details;
  }

  toDetail() {
    return {
      category: this.category,
      message: this.message,
      ...this.details,
    };
  }
}

export class ApiError extends AppError {
  readonly category = ErrorCategory.API;

  constructor(message: string, details: AppErrorDetails = {}) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE, details);
  }
}

export class DatabaseError extends AppError {
  readonly category = ErrorCategory.DATABASE;

  constructor(message: string, details: AppErrorDetails = {}) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}

export class ValidationError extends AppError {
  readonly category = ErrorCategory.VALIDATION;

  constructor(message: string, details: AppErrorDetails = {}) {
    super(message, HttpStatus.BAD_REQUEST, details);
  }
}

export class BusinessError extends AppError {
  readonly category = ErrorCategory.BUSINESS;

  constructor(message: string, details: AppErrorDetails = {}) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class UnknownError extends AppError {
  readonly category = ErrorCategory.UNKNOWN;

  constructor(message: string, details: AppErrorDetails = {}) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}
