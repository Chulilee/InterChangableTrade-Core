import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ValidationRule {
  field: string;
  type: 'required' | 'pattern' | 'range' | 'custom';
  value?: any;
  message: string;
}

export interface EntityValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; value: any }>;
}

@Injectable()
export class DataValidationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((response) => {
        if (response && typeof response === 'object') {
          const validation = this.validateResponse(response);
          if (!validation.valid) {
            throw new BadRequestException({
              message: 'Data validation failed',
              errors: validation.errors,
            });
          }
        }
        return response;
      }),
    );
  }

  validateResponse(data: any): EntityValidationResult {
    const errors: Array<{ field: string; message: string; value: any }> = [];

    if (data.data && Array.isArray(data.data)) {
      for (let i = 0; i < data.data.length; i++) {
        const itemErrors = this.validateEntity(data.data[i]);
        for (const err of itemErrors) {
          errors.push({ ...err, field: `data[${i}].${err.field}` });
        }
      }
    } else if (data.data && typeof data.data === 'object') {
      const itemErrors = this.validateEntity(data.data);
      for (const err of itemErrors) {
        errors.push({ field: `data.${err.field}`, message: err.message, value: err.value });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateEntity(entity: any): Array<{ field: string; message: string; value: any }> {
    const errors: Array<{ field: string; message: string; value: any }> = [];

    if (!entity || typeof entity !== 'object') {
      errors.push({ field: 'entity', message: 'Entity must be an object', value: entity });
      return errors;
    }

    if (entity.id && (typeof entity.id !== 'string' || entity.id.length === 0)) {
      errors.push({ field: 'id', message: 'ID must be a non-empty string', value: entity.id });
    }

    if (entity.createdAt && !this.isValidDate(entity.createdAt)) {
      errors.push({
        field: 'createdAt',
        message: 'createdAt must be a valid date',
        value: entity.createdAt,
      });
    }

    if (entity.updatedAt && !this.isValidDate(entity.updatedAt)) {
      errors.push({
        field: 'updatedAt',
        message: 'updatedAt must be a valid date',
        value: entity.updatedAt,
      });
    }

    if (entity.amount !== undefined && (typeof entity.amount !== 'number' || entity.amount < 0)) {
      errors.push({
        field: 'amount',
        message: 'Amount must be a non-negative number',
        value: entity.amount,
      });
    }

    if (entity.price !== undefined && (typeof entity.price !== 'number' || entity.price < 0)) {
      errors.push({
        field: 'price',
        message: 'Price must be a non-negative number',
        value: entity.price,
      });
    }

    if (entity.status && !this.isValidEnum(entity.status)) {
      errors.push({
        field: 'status',
        message: 'Status must be a valid string enum',
        value: entity.status,
      });
    }

    return errors;
  }

  private isValidDate(value: any): boolean {
    return value instanceof Date || !isNaN(Date.parse(value));
  }

  private isValidEnum(value: any): boolean {
    return typeof value === 'string' && value.length > 0;
  }
}
