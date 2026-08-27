import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

/**
 * Wraps a request handler in a single database transaction, giving
 * `@Transactional()`-annotated handlers ACID guarantees across every
 * repository call they make: the transaction commits when the handler
 * completes successfully and rolls back — atomically undoing every write
 * made through it — when the handler throws.
 *
 * The transactional `EntityManager` is attached to the request so handlers
 * and the services they call can read from it via the `@TransactionManager()`
 * param decorator (see `transaction-manager.decorator.ts`) instead of the
 * module-wide (non-transactional) repository.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TransactionInterceptor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const request = context.switchToHttp().getRequest();
    request.queryRunner = queryRunner;

    return next.handle().pipe(
      tap(async () => {
        await queryRunner.commitTransaction();
        await queryRunner.release();
      }),
      catchError(async (err) => {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackErr) {
          this.logger.error(
            `Failed to roll back transaction: ${
              (rollbackErr as Error).message
            }`,
          );
        } finally {
          await queryRunner.release();
        }
        throw err;
      }),
    );
  }
}
