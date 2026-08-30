import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Extracts the transactional `EntityManager` attached to the request by
 * `TransactionInterceptor`. Use it in a handler guarded by `@Transactional()`
 * to run repository calls inside the request's transaction instead of the
 * ambient (non-transactional) connection:
 *
 * ```ts
 * @Transactional()
 * @Post()
 * create(@TransactionManager() manager: EntityManager, @Body() dto: CreateDto) {
 *   return manager.getRepository(Widget).save(dto);
 * }
 * ```
 *
 * Throws if used outside a `@Transactional()`-wrapped handler, since that
 * indicates a missing decorator rather than a state a caller should silently
 * work around.
 */
export const transactionManagerFactory = (
  _data: unknown,
  ctx: ExecutionContext,
): EntityManager => {
  const request = ctx.switchToHttp().getRequest();
  const manager = request.queryRunner?.manager;
  if (!manager) {
    throw new InternalServerErrorException(
      '@TransactionManager() used without @Transactional() — no active transaction on this request.',
    );
  }
  return manager;
};

export const TransactionManager = createParamDecorator(
  transactionManagerFactory,
);
