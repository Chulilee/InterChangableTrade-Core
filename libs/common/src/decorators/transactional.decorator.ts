import { UseInterceptors } from '@nestjs/common';
import { TransactionInterceptor } from '../interceptors/transaction.interceptor';

export function Transactional(): MethodDecorator {
  return UseInterceptors(TransactionInterceptor);
}
