import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EscrowTimelineService } from './escrow-timeline.service';
import { EscrowTimeline } from '../entities/escrow-timeline.entity';
import { EscrowTimelineEventType } from '../enums/escrow-timeline-event-type.enum';

describe('EscrowTimelineService', () => {
  let service: EscrowTimelineService;

  const timelineRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const escrowAccountId = 'escrow-1';
  const actorId = 'user-1';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowTimelineService,
        {
          provide: getRepositoryToken(EscrowTimeline),
          useValue: timelineRepository,
        },
      ],
    }).compile();

    service = module.get<EscrowTimelineService>(EscrowTimelineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addEvent', () => {
    it('creates a row with the right escrowAccountId, eventType, actorId, and metadata', async () => {
      const metadata = { txHash: 'abc123', step: 2 };
      const created = {
        escrowAccountId,
        eventType: EscrowTimelineEventType.ESCROW_FUNDED,
        actorId,
        description: 'Escrow funded',
        metadata,
      };
      const saved = {
        id: 'timeline-1',
        ...created,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };

      timelineRepository.create.mockReturnValue(created);
      timelineRepository.save.mockResolvedValue(saved);

      const result = await service.addEvent(
        escrowAccountId,
        EscrowTimelineEventType.ESCROW_FUNDED,
        actorId,
        'Escrow funded',
        metadata,
      );

      expect(timelineRepository.create).toHaveBeenCalledWith({
        escrowAccountId,
        eventType: EscrowTimelineEventType.ESCROW_FUNDED,
        actorId,
        description: 'Escrow funded',
        metadata,
      });
      expect(timelineRepository.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(saved);
    });

    it('accepts optional metadata and leaves it undefined/null when omitted', async () => {
      const created = {
        escrowAccountId,
        eventType: EscrowTimelineEventType.ESCROW_CREATED,
        actorId,
        description: 'Created',
        metadata: undefined,
      };
      const saved = {
        id: 'timeline-2',
        ...created,
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      };

      timelineRepository.create.mockReturnValue(created);
      timelineRepository.save.mockResolvedValue(saved);

      const result = await service.addEvent(
        escrowAccountId,
        EscrowTimelineEventType.ESCROW_CREATED,
        actorId,
        'Created',
      );

      expect(timelineRepository.create).toHaveBeenCalledWith({
        escrowAccountId,
        eventType: EscrowTimelineEventType.ESCROW_CREATED,
        actorId,
        description: 'Created',
        metadata: undefined,
      });
      expect(result.metadata).toBeNull();
    });

    it('uses the provided transactional manager repository when given', async () => {
      const created = {
        escrowAccountId,
        eventType: EscrowTimelineEventType.ESCROW_SETTLED,
        actorId,
        description: 'Settled',
        metadata: undefined,
      };
      const saved = {
        id: 'timeline-3',
        ...created,
        createdAt: new Date('2026-01-01T00:00:02.000Z'),
      };
      const managerRepository = {
        create: jest.fn().mockReturnValue(created),
        save: jest.fn().mockResolvedValue(saved),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerRepository),
      };

      const result = await service.addEvent(
        escrowAccountId,
        EscrowTimelineEventType.ESCROW_SETTLED,
        actorId,
        'Settled',
        undefined,
        manager as never,
      );

      expect(manager.getRepository).toHaveBeenCalledWith(EscrowTimeline);
      expect(managerRepository.create).toHaveBeenCalledWith(created);
      expect(managerRepository.save).toHaveBeenCalledWith(created);
      expect(timelineRepository.create).not.toHaveBeenCalled();
      expect(timelineRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual(saved);
    });
  });

  describe('getTimeline', () => {
    it('returns events for one escrow only in stable chronological order', async () => {
      const events = [
        {
          id: 'timeline-1',
          escrowAccountId,
          eventType: EscrowTimelineEventType.ESCROW_CREATED,
          actorId,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'timeline-2',
          escrowAccountId,
          eventType: EscrowTimelineEventType.ESCROW_FUNDED,
          actorId,
          createdAt: new Date('2026-01-01T01:00:00.000Z'),
        },
      ];
      timelineRepository.find.mockResolvedValue(events);

      const result = await service.getTimeline(escrowAccountId);

      expect(timelineRepository.find).toHaveBeenCalledWith({
        where: { escrowAccountId },
        order: { createdAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
      expect(result.map((event) => event.id)).toEqual([
        'timeline-1',
        'timeline-2',
      ]);
      expect(
        result[0].createdAt.getTime() <= result[1].createdAt.getTime(),
      ).toBe(true);
    });

    it('handles an escrow with no events without throwing', async () => {
      timelineRepository.find.mockResolvedValue([]);

      await expect(service.getTimeline('escrow-empty')).resolves.toEqual([]);
      expect(timelineRepository.find).toHaveBeenCalledWith({
        where: { escrowAccountId: 'escrow-empty' },
        order: { createdAt: 'ASC' },
      });
    });
  });
});

/**
 * NOTE: EscrowTimelineService can write via its injected repository or via a
 * caller-provided transactional EntityManager. Escrow operations that wrap state
 * changes in a queryRunner transaction must pass the transaction manager to
 * addEvent() so timeline rows commit/rollback atomically with the parent
 * operation; otherwise the audit trail can drift from escrow state.
 */
