import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DisputeResolutionService } from './dispute-resolution.service';
import { Dispute } from './entities/dispute.entity';
import { DisputeStatus } from './enums/dispute-status.enum';
import { DisputeClassification } from './enums/dispute-classification.enum';
import { DisputeResolutionType } from './enums/dispute-resolution-type.enum';
import { DisputeEvidenceService } from './services/dispute-evidence.service';
import { ArbitratorService } from './services/arbitrator.service';
import { DisputePatternDetectionService } from './services/dispute-pattern-detection.service';
import { DisputeEnforcementService } from './services/dispute-enforcement.service';
import { Trade } from '../trading-engine/entities/trade.entity';
import { UserRole } from '../users/entities/user.entity';
import { DisputeEvents } from './events/dispute.events';
import { UploadedFilePayload } from './types/uploaded-file.type';
import {
  INITIAL_REVIEW_SLA_HOURS,
  RESOLUTION_SLA_DAYS,
  MAX_DISPUTES_PER_USER_PER_MONTH,
} from './constants/dispute.constants';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount?: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createQueryBuilderMock(data: any[] = [], total?: number) {
  const qb = {
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([data, total ?? data.length]),
  };
  return qb;
}

describe('DisputeResolutionService', () => {
  let service: DisputeResolutionService;
  let disputeRepo: RepoMock;
  let timelineRepo: RepoMock;
  let messageRepo: RepoMock;
  let tradeRepo: RepoMock;
  let evidenceService: jest.Mocked<Partial<DisputeEvidenceService>>;
  let arbitratorService: jest.Mocked<Partial<ArbitratorService>>;
  let patternDetectionService: jest.Mocked<
    Partial<DisputePatternDetectionService>
  >;
  let enforcementService: jest.Mocked<Partial<DisputeEnforcementService>>;
  let eventEmitter: jest.Mocked<Partial<EventEmitter2>>;

  const userId = 'user-complainant';
  const respondentId = 'user-respondent';
  const tradeId = 'trade-1';

  const mockTrade: Partial<Trade> = {
    id: tradeId,
    makerUserId: userId,
    takerUserId: respondentId,
    assetCode: 'XLM',
    quantity: '100.0000000',
    price: '1.0000000',
  };

  beforeEach(() => {
    disputeRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((v) => ({ id: 'dispute-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    timelineRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'timeline-1', ...v })),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    messageRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'msg-1', ...v })),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    tradeRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    evidenceService = {
      saveEvidence: jest.fn().mockResolvedValue({ id: 'evidence-1' }),
      findByDispute: jest.fn().mockResolvedValue([]),
    };

    arbitratorService = {
      assignArbitrator: jest.fn().mockResolvedValue(null),
      releaseArbitrator: jest.fn().mockResolvedValue(undefined),
    };

    patternDetectionService = {
      flagIfSimilar: jest.fn().mockResolvedValue(false),
    };

    enforcementService = {
      executeEnforcement: jest.fn().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    service = new DisputeResolutionService(
      disputeRepo as never,
      timelineRepo as never,
      messageRepo as never,
      tradeRepo as never,
      evidenceService as never,
      arbitratorService as never,
      patternDetectionService as never,
      enforcementService as never,
      eventEmitter as never,
    );
  });

  describe('createDispute', () => {
    const createDto = {
      tradeId,
      classification: DisputeClassification.NON_DELIVERY,
      description: 'The asset was never delivered to my wallet as agreed.',
    };

    it('creates a dispute with SLA deadlines', async () => {
      tradeRepo.findOne.mockResolvedValue(mockTrade);
      disputeRepo.findOne.mockResolvedValue(null);

      const before = Date.now();
      const result = await service.createDispute(userId, createDto);
      const after = Date.now();

      expect(result.status).toBe(DisputeStatus.FILED);
      expect(result.complainantId).toBe(userId);
      expect(result.respondentId).toBe(respondentId);

      const reviewMs = result.initialReviewDeadline.getTime() - before;
      expect(reviewMs).toBeGreaterThanOrEqual(
        INITIAL_REVIEW_SLA_HOURS * 60 * 60 * 1000 - 1000,
      );
      expect(reviewMs).toBeLessThanOrEqual(
        INITIAL_REVIEW_SLA_HOURS * 60 * 60 * 1000 + (after - before) + 1000,
      );

      const resolutionMs = result.resolutionDeadline.getTime() - before;
      expect(resolutionMs).toBeGreaterThanOrEqual(
        RESOLUTION_SLA_DAYS * 24 * 60 * 60 * 1000 - 1000,
      );
    });

    it('rejects when trade not found', async () => {
      tradeRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createDispute(userId, createDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when user is not a trade participant', async () => {
      tradeRepo.findOne.mockResolvedValue(mockTrade);
      await expect(
        service.createDispute('outsider', createDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects duplicate active dispute', async () => {
      tradeRepo.findOne.mockResolvedValue(mockTrade);
      disputeRepo.findOne.mockResolvedValue({
        id: 'existing',
        status: DisputeStatus.FILED,
      });

      await expect(
        service.createDispute(userId, createDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects frivolous disputes exceeding monthly limit', async () => {
      disputeRepo.count.mockResolvedValue(MAX_DISPUTES_PER_USER_PER_MONTH);

      await expect(
        service.createDispute(userId, createDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assigns arbitrator when available', async () => {
      tradeRepo.findOne.mockResolvedValue(mockTrade);
      disputeRepo.findOne.mockResolvedValue(null);
      (arbitratorService.assignArbitrator as jest.Mock).mockResolvedValue({
        userId: 'arb-1',
        activeDisputeCount: 1,
      } as never);

      const result = await service.createDispute(userId, createDto);

      expect(result.arbitratorId).toBe('arb-1');
      expect(result.status).toBe(DisputeStatus.UNDER_REVIEW);
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('runs pattern detection on creation', async () => {
      tradeRepo.findOne.mockResolvedValue(mockTrade);
      disputeRepo.findOne.mockResolvedValue(null);

      await service.createDispute(userId, createDto);

      expect(patternDetectionService.flagIfSimilar).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    const mockDispute: Partial<Dispute> = {
      id: 'dispute-1',
      complainantId: userId,
      respondentId,
      status: DisputeStatus.FILED,
      initialReviewDeadline: new Date(Date.now() + 86400000),
      resolutionDeadline: new Date(Date.now() + 14 * 86400000),
    };

    it('returns dispute details for a party', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      const result = await service.findOne('dispute-1', userId, UserRole.USER);

      expect(result.dispute).toEqual(mockDispute);
      expect(result.slaStatus).toBeDefined();
      expect(result.evidence).toEqual([]);
    });

    it('allows admin access', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      const result = await service.findOne(
        'dispute-1',
        'admin-id',
        UserRole.ADMIN,
      );

      expect(result.dispute).toEqual(mockDispute);
    });

    it('rejects unauthorized access', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      await expect(
        service.findOne('dispute-1', 'outsider', UserRole.USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when dispute not found', async () => {
      disputeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('missing', userId, UserRole.USER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submitEvidence', () => {
    const mockDispute: Partial<Dispute> = {
      id: 'dispute-1',
      complainantId: userId,
      respondentId,
      status: DisputeStatus.FILED,
    };

    const mockFile = {
      originalname: 'proof.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('test'),
    } as UploadedFilePayload;

    it('submits evidence and transitions to investigation', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      const result = await service.submitEvidence(
        'dispute-1',
        userId,
        UserRole.USER,
        mockFile,
        'Proof of non-delivery',
      );

      expect(result).toEqual({ id: 'evidence-1' });
      expect(evidenceService.saveEvidence).toHaveBeenCalled();
      expect(disputeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: DisputeStatus.INVESTIGATION }),
      );
    });

    it('rejects evidence on closed disputes', async () => {
      disputeRepo.findOne.mockResolvedValue({
        ...mockDispute,
        status: DisputeStatus.RESOLVED,
      });

      await expect(
        service.submitEvidence('dispute-1', userId, UserRole.USER, mockFile),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveDispute', () => {
    const mockDispute: Partial<Dispute> = {
      id: 'dispute-1',
      complainantId: userId,
      respondentId,
      status: DisputeStatus.INVESTIGATION,
      tradeId,
      arbitratorId: 'arb-1',
    };

    const resolveDto = {
      resolutionType: DisputeResolutionType.REFUND,
      decisionReasoning:
        'Evidence confirms non-delivery. Refund is warranted per platform policy.',
      resolutionAmount: '100.0000000',
    };

    it('resolves dispute and executes enforcement', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      const result = await service.resolveDispute(
        'dispute-1',
        'arb-1',
        UserRole.ARBITRATOR,
        resolveDto,
      );

      expect(result.status).toBe(DisputeStatus.RESOLVED);
      expect(result.resolutionType).toBe(DisputeResolutionType.REFUND);
      expect(enforcementService.executeEnforcement).toHaveBeenCalled();
      expect(arbitratorService.releaseArbitrator).toHaveBeenCalledWith('arb-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        DisputeEvents.DISPUTE_RESOLVED,
        expect.objectContaining({
          complainantId: userId,
          respondentId,
        }),
      );
    });

    it('rejects arbitrator resolving unassigned dispute', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      await expect(
        service.resolveDispute(
          'dispute-1',
          'other-arb',
          UserRole.ARBITRATOR,
          resolveDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects resolving already closed dispute', async () => {
      disputeRepo.findOne.mockResolvedValue({
        ...mockDispute,
        status: DisputeStatus.CLOSED,
      });

      await expect(
        service.resolveDispute(
          'dispute-1',
          'arb-1',
          UserRole.ADMIN,
          resolveDto,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('appealDispute', () => {
    const appealReason =
      'The decision was incorrect because new evidence was discovered after resolution.';

    function mockResolvedDispute(
      overrides: Partial<Dispute> = {},
    ): Partial<Dispute> {
      return {
        id: 'dispute-1',
        complainantId: userId,
        respondentId,
        status: DisputeStatus.RESOLVED,
        appealed: false,
        classification: DisputeClassification.FRAUD,
        ...overrides,
      };
    }

    it('allows one appeal per dispute', async () => {
      disputeRepo.findOne.mockResolvedValue(
        mockResolvedDispute({ enforcementExecuted: true }),
      );

      const result = await service.appealDispute('dispute-1', userId, {
        appealReason,
      });

      expect(result.appealed).toBe(true);
      expect(result.status).toBe(DisputeStatus.APPEALED);
      expect(result.enforcementExecuted).toBe(false);
    });

    it('rejects second appeal', async () => {
      disputeRepo.findOne.mockResolvedValue(
        mockResolvedDispute({ appealed: true }),
      );

      await expect(
        service.appealDispute('dispute-1', userId, {
          appealReason: 'Trying to appeal again which should not be allowed.',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects appeal from non-party', async () => {
      disputeRepo.findOne.mockResolvedValue(mockResolvedDispute());

      await expect(
        service.appealDispute('dispute-1', 'outsider', {
          appealReason: 'I am not a party but trying to appeal this dispute.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects appeal on non-resolved dispute', async () => {
      disputeRepo.findOne.mockResolvedValue(
        mockResolvedDispute({ status: DisputeStatus.INVESTIGATION }),
      );

      await expect(
        service.appealDispute('dispute-1', userId, {
          appealReason:
            'Cannot appeal while dispute is still under investigation.',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assigns new arbitrator on appeal', async () => {
      disputeRepo.findOne.mockResolvedValue(mockResolvedDispute());
      (arbitratorService.assignArbitrator as jest.Mock).mockResolvedValue({
        userId: 'arb-2',
        activeDisputeCount: 1,
      });

      const result = await service.appealDispute('dispute-1', userId, {
        appealReason,
      });

      expect(result.status).toBe(DisputeStatus.ARBITRATION);
      expect(result.arbitratorId).toBe('arb-2');
    });
  });

  describe('sendMessage', () => {
    const mockDispute: Partial<Dispute> = {
      id: 'dispute-1',
      complainantId: userId,
      respondentId,
      status: DisputeStatus.INVESTIGATION,
    };

    it('sends a message between parties', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      const result = await service.sendMessage(
        'dispute-1',
        userId,
        UserRole.USER,
        {
          content: 'I have additional information about this dispute.',
        },
      );

      expect(result.content).toBe(
        'I have additional information about this dispute.',
      );
    });

    it('rejects internal messages from regular users', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      await expect(
        service.sendMessage('dispute-1', userId, UserRole.USER, {
          content: 'Internal note attempt',
          isInternal: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getTimeline', () => {
    const mockDispute: Partial<Dispute> = {
      id: 'dispute-1',
      complainantId: userId,
      respondentId,
      status: DisputeStatus.INVESTIGATION,
    };

    it('returns timeline for authorized party', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);
      timelineRepo.find.mockResolvedValue([{ id: 'event-1' }]);

      const result = await service.getTimeline(
        'dispute-1',
        userId,
        UserRole.USER,
      );

      expect(result).toHaveLength(1);
    });

    it('rejects unauthorized timeline access', async () => {
      disputeRepo.findOne.mockResolvedValue(mockDispute);

      await expect(
        service.getTimeline('dispute-1', 'outsider', UserRole.USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('filters by user for non-staff', async () => {
      const qb = createQueryBuilderMock([], 0);
      disputeRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, UserRole.USER, {
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(dispute.complainantId = :userId OR dispute.respondentId = :userId)',
        { userId },
      );
    });

    it('does not filter by user for admin', async () => {
      const qb = createQueryBuilderMock([], 0);
      disputeRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll('admin-id', UserRole.ADMIN, {
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('complainantId'),
        expect.anything(),
      );
    });
  });
});
