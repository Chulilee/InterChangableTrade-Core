import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Attach the queryRunner to the request object
    const request = context.switchToHttp().getRequest();
    request.queryRunner = queryRunner;

    return next.handle().pipe(
      tap(async () => {
        await queryRunner.commitTransaction();
        await queryRunner.release();
      }),
      catchError(async (err) => {
        await queryRunner.rollbackTransaction();
        await queryRunner.release();
        throw err;
      }),
    );
  }
}
