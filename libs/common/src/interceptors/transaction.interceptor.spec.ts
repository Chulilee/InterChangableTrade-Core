import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { TransactionInterceptor } from './transaction.interceptor';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

/** `intercept()` is async (it awaits `queryRunner.connect()`), so it resolves
 * to an `Observable` rather than returning one synchronously — await it
 * before handing it to `lastValueFrom`. */
async function run(
  interceptor: TransactionInterceptor,
  ctx: ExecutionContext,
  next: CallHandler,
): Promise<unknown> {
  return lastValueFrom(await interceptor.intercept(ctx, next));
}

describe('TransactionInterceptor', () => {
  let interceptor: TransactionInterceptor;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(() => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = { createQueryRunner: jest.fn().mockReturnValue(queryRunner) };
    interceptor = new TransactionInterceptor(
      dataSource as unknown as DataSource,
    );
  });

  it('starts a transaction, attaches the queryRunner to the request, and commits on success', async () => {
    const req: Record<string, unknown> = {};
    const ctx = buildContext(req);
    const next: CallHandler = { handle: () => of({ ok: true }) };

    const result = await run(interceptor, ctx, next);

    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(req.queryRunner).toBe(queryRunner);
    expect(result).toEqual({ ok: true });

    // commit happens asynchronously inside `tap`; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rolls back and releases the connection when the handler throws', async () => {
    const req: Record<string, unknown> = {};
    const ctx = buildContext(req);
    const error = new Error('boom');
    const next: CallHandler = { handle: () => throwError(() => error) };

    await expect(run(interceptor, ctx, next)).rejects.toThrow('boom');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('still releases the connection when rollback itself fails', async () => {
    const req: Record<string, unknown> = {};
    const ctx = buildContext(req);
    const handlerError = new Error('handler failed');
    queryRunner.rollbackTransaction.mockRejectedValue(
      new Error('rollback failed'),
    );
    const next: CallHandler = {
      handle: () => throwError(() => handlerError),
    };

    await expect(run(interceptor, ctx, next)).rejects.toThrow('handler failed');

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('passes through non-http contexts without opening a transaction', async () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('passthrough') };

    const result = await run(interceptor, ctx, next);

    expect(result).toBe('passthrough');
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});
