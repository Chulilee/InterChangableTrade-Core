import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArbitratorService } from './arbitrator.service';
import { DisputeClassification } from '../enums/dispute-classification.enum';
import { ArbitratorExpertise } from '../enums/arbitrator-expertise.enum';
import { UserRole } from '../../users/entities/user.entity';

describe('ArbitratorService', () => {
  let service: ArbitratorService;
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let userRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(),
    };
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    service = new ArbitratorService(repo as never, userRepo as never);
  });

  describe('createArbitrator', () => {
    it('creates a new arbitrator and promotes user role', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1', role: UserRole.USER });
      repo.findOne.mockResolvedValue(null);

      const result = await service.createArbitrator({
        userId: 'user-1',
        expertise: [ArbitratorExpertise.FRAUD],
      });

      expect(result.userId).toBe('user-1');
      expect(repo.save).toHaveBeenCalled();
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ARBITRATOR }),
      );
    });

    it('does not change role for existing admins', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        role: UserRole.ADMIN,
      });
      repo.findOne.mockResolvedValue(null);

      await service.createArbitrator({
        userId: 'user-1',
        expertise: [ArbitratorExpertise.GENERAL],
      });

      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createArbitrator({
          userId: 'missing',
          expertise: [ArbitratorExpertise.GENERAL],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects duplicate arbitrator registration', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1', role: UserRole.USER });
      repo.findOne.mockResolvedValue({ userId: 'user-1' });

      await expect(
        service.createArbitrator({
          userId: 'user-1',
          expertise: [ArbitratorExpertise.GENERAL],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assignArbitrator', () => {
    it('assigns arbitrator with matching expertise and lowest load', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            { userId: 'arb-1', activeDisputeCount: 2, maxActiveDisputes: 10 },
          ]),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.assignArbitrator(
        DisputeClassification.FRAUD,
      );

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('arb-1');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ activeDisputeCount: 3 }),
      );
    });

    it('returns null when no arbitrators available', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.assignArbitrator(
        DisputeClassification.SYSTEM_ERROR,
      );

      expect(result).toBeNull();
    });
  });

  describe('releaseArbitrator', () => {
    it('decrements active count and increments resolved', async () => {
      repo.findOne.mockResolvedValue({
        userId: 'arb-1',
        activeDisputeCount: 3,
        totalResolved: 5,
      });

      await service.releaseArbitrator('arb-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          activeDisputeCount: 2,
          totalResolved: 6,
        }),
      );
    });
  });
});
