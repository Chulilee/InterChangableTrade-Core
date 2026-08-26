import {
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { AuditContextService } from './audit-context';
import { AuditTrailSubscriber } from './audit-trail.subscriber';

type TrailRepo = { create: jest.Mock; insert: jest.Mock };

const buildCtx = () => {
  const trailRepo: TrailRepo = {
    create: jest.fn((v) => v),
    insert: jest.fn().mockResolvedValue(undefined),
  };
  return {
    trailRepo,
    manager: { getRepository: jest.fn(() => trailRepo) },
  };
};

const buildEvent = <T>(targetName: string, extra: Record<string, unknown>) =>
  ({ metadata: { targetName }, ...extra }) as unknown as T;

/**
 * Exercises the real subscriber against a stubbed repository: rows must
 * record actor/action/before/after, skip the trail table itself, and never
 * break the operation being observed.
 */
describe('AuditTrailSubscriber', () => {
  let subscriber: AuditTrailSubscriber;
  let ctx: ReturnType<typeof buildCtx>;

  beforeEach(() => {
    ctx = buildCtx();
    subscriber = new AuditTrailSubscriber({} as never);
  });

  it('records inserts with the system actor by default', async () => {
    await subscriber.afterInsert(
      buildEvent<InsertEvent<unknown>>('Wallet', {
        entity: { id: 'w1', balance: 10 },
        manager: ctx.manager,
      }),
    );

    expect(ctx.trailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'system',
        action: 'insert',
        entityType: 'Wallet',
        entityId: 'w1',
        before: null,
        after: { id: 'w1', balance: 10 },
      }),
    );
  });

  it('attributes updates to the request actor and captures before/after', async () => {
    await AuditContextService.run({ id: 'user-9' }, async () => {
      await subscriber.afterUpdate(
        buildEvent<UpdateEvent<unknown>>('Wallet', {
          databaseEntity: { id: 'w1', balance: 10 },
          entity: { id: 'w1', balance: 25 },
          manager: ctx.manager,
        }),
      );
    });

    expect(ctx.trailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-9',
        action: 'update',
        before: { id: 'w1', balance: 10 },
        after: { id: 'w1', balance: 25 },
      }),
    );
  });

  it('captures only the prior state for deletes', async () => {
    await subscriber.afterRemove(
      buildEvent<RemoveEvent<unknown>>('Wallet', {
        databaseEntity: { id: 'w2', balance: 0 },
        entity: undefined,
        manager: ctx.manager,
      }),
    );

    expect(ctx.trailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        entityType: 'Wallet',
        entityId: 'w2',
        before: { id: 'w2', balance: 0 },
        after: null,
      }),
    );
  });

  it('never audits the audit trail itself (recursion guard)', async () => {
    await subscriber.afterInsert(
      buildEvent<InsertEvent<unknown>>('AuditTrail', {
        entity: { id: 'a1' },
        manager: ctx.manager,
      }),
    );

    expect(ctx.trailRepo.insert).not.toHaveBeenCalled();
  });

  it('swallows persistence failures so business flow is unaffected', async () => {
    ctx.trailRepo.insert.mockRejectedValueOnce(new Error('audit write failed'));

    await expect(
      subscriber.afterInsert(
        buildEvent<InsertEvent<unknown>>('Wallet', {
          entity: { id: 'w3' },
          manager: ctx.manager,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(ctx.trailRepo.insert).toHaveBeenCalledTimes(1);
  });
});
