import { ExecutionContext } from '@nestjs/common';
import { transactionManagerFactory } from './transaction-manager.decorator';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('TransactionManager decorator', () => {
  it('returns the EntityManager attached by TransactionInterceptor', () => {
    const manager = { save: jest.fn() };
    const ctx = buildContext({ queryRunner: { manager } });

    expect(transactionManagerFactory(undefined, ctx)).toBe(manager);
  });

  it('throws when no transaction is active on the request', () => {
    const ctx = buildContext({});

    expect(() => transactionManagerFactory(undefined, ctx)).toThrow(
      /without @Transactional\(\)/,
    );
  });
});
