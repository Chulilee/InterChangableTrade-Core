import { UnauthorizedException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { DataSource, Repository } from 'typeorm';
import { StellarAuthService } from './stellar-auth.service';
import { StellarAuthChallenge } from './entities/stellar-auth-challenge.entity';

const KEYPAIR = StellarSdk.Keypair.random();
const PUBLIC_KEY = KEYPAIR.publicKey();
const NONCE = 'challenge-nonce-for-tests';

function sign(nonce: string): string {
  return KEYPAIR.sign(Buffer.from(nonce, 'utf8')).toString('base64');
}

function makeChallenge(
  overrides: Partial<StellarAuthChallenge> = {},
): StellarAuthChallenge {
  return {
    id: 'challenge-1',
    nonce: NONCE,
    publicKey: PUBLIC_KEY,
    expiresAt: new Date(Date.now() + 60_000),
    isUsed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StellarAuthChallenge;
}

interface HarnessOptions {
  initialChallenge?: StellarAuthChallenge | null;
  latestChallenge?: StellarAuthChallenge;
  now?: Date;
}

/**
 * Builds a service whose DataSource transaction mock serialises callbacks the
 * same way a real row lock serialises concurrent transactions. The conditional
 * UPDATE only reports `affected: 1` to the first writer, so the test exercises
 * the real race instead of merely calling the method twice in sequence.
 */
function createHarness(options: HarnessOptions = {}) {
  const state = {
    used: options.initialChallenge?.isUsed ?? false,
    updateCalls: 0,
    deleteCalls: 0,
    saveCalls: 0,
  };

  const initialChallenge =
    options.initialChallenge === undefined
      ? makeChallenge()
      : options.initialChallenge;

  const challengeRepo = {
    findOne: jest.fn(async () =>
      initialChallenge
        ? { ...initialChallenge, isUsed: state.used }
        : null,
    ),
    create: jest.fn((value: Partial<StellarAuthChallenge>) => ({ ...value })),
    save: jest.fn(async (value: StellarAuthChallenge) => {
      state.saveCalls += 1;
      return value;
    }),
    delete: jest.fn(async () => {
      state.deleteCalls += 1;
      return { affected: 0 };
    }),
  };

  const updateBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => {
      state.updateCalls += 1;
      if (state.used) {
        return { affected: 0 };
      }
      state.used = true;
      return { affected: 1 };
    }),
  };

  const transactionalRepo = {
    findOne: jest.fn(async (findOptions: { lock?: unknown }) => {
      if (findOptions.lock) {
        return initialChallenge
          ? { ...initialChallenge, isUsed: state.used }
          : null;
      }
      return options.latestChallenge
        ? { ...options.latestChallenge, isUsed: state.used }
        : initialChallenge
          ? { ...initialChallenge, isUsed: state.used }
          : null;
    }),
    createQueryBuilder: jest.fn(() => updateBuilder),
  };

  // Serialise transaction callbacks with a simple promise mutex.
  let mutex: Promise<void> = Promise.resolve();
  const dataSource = {
    transaction: jest.fn(
      async (callback: (manager: unknown) => Promise<unknown>) => {
        const previous = mutex;
        let release!: () => void;
        mutex = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback({
            getRepository: () => transactionalRepo,
          });
        } finally {
          release();
        }
      },
    ),
  };

  const service = new StellarAuthService(
    challengeRepo as unknown as Repository<StellarAuthChallenge>,
    dataSource as unknown as DataSource,
  );

  return { service, state, challengeRepo, dataSource, updateBuilder };
}

describe('StellarAuthService', () => {
  describe('createChallenge', () => {
    it('does not delete existing challenges for the key', async () => {
      const { service, challengeRepo, state } = createHarness();

      const result = await service.createChallenge(PUBLIC_KEY);

      expect(result.nonce).toHaveLength(64);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(challengeRepo.delete).not.toHaveBeenCalled();
      expect(challengeRepo.save).toHaveBeenCalledTimes(1);
      expect(state.deleteCalls).toBe(0);
    });
  });

  describe('verifyChallenge', () => {
    it('accepts a valid signature and consumes the challenge', async () => {
      const { service, state, updateBuilder } = createHarness();

      await expect(
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
      ).resolves.toBe(PUBLIC_KEY);

      expect(updateBuilder.execute).toHaveBeenCalledTimes(1);
      expect(state.used).toBe(true);
    });

    it('does not consume a challenge when the signature is invalid', async () => {
      const { service, state, updateBuilder } = createHarness();

      await expect(
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign('wrong message')),
      ).rejects.toThrow(UnauthorizedException);

      expect(updateBuilder.execute).not.toHaveBeenCalled();
      expect(state.used).toBe(false);
    });

    it('rejects a challenge that has been superseded by a newer one', async () => {
      const { service } = createHarness({
        initialChallenge: makeChallenge({ id: 'older' }),
        latestChallenge: makeChallenge({ id: 'newer' }),
      });

      await expect(
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
      ).rejects.toThrow('superseded');
    });

    it('rejects an already-used challenge before starting a transaction', async () => {
      const { service, dataSource } = createHarness({
        initialChallenge: makeChallenge({ isUsed: true }),
      });

      await expect(
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
      ).rejects.toThrow('already used');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge before starting a transaction', async () => {
      const { service, dataSource } = createHarness({
        initialChallenge: makeChallenge({
          expiresAt: new Date(Date.now() - 1_000),
        }),
      });

      await expect(
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
      ).rejects.toThrow('expired');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('allows exactly one of two concurrent calls with the same signed nonce', async () => {
      const { service, state } = createHarness();

      const results = await Promise.allSettled([
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
        service.verifyChallenge(NONCE, PUBLIC_KEY, sign(NONCE)),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        UnauthorizedException,
      );
      expect(state.used).toBe(true);
    });
  });
});
