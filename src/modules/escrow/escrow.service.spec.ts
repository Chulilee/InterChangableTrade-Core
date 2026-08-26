import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, QueryRunner } from 'typeorm';
import { EscrowService } from './escrow.service';
import { EscrowAccount } from './entities/escrow-account.entity';
import { EscrowSignatory } from './entities/escrow-signatory.entity';
import { EscrowMilestone } from './entities/escrow-milestone.entity';
import { EscrowStatus } from './enums/escrow-status.enum';
import { EscrowType } from './enums/escrow-type.enum';
import { SignatoryRole } from './enums/signatory-role.enum';
import { EscrowTimelineService } from './services/escrow-timeline.service';
import { EscrowEvents } from './events/escrow.events';

type RepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
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

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: RepoMock;
  let signatoryRepo: RepoMock;
  let milestoneRepo: RepoMock;
  let timelineService: { addEvent: jest.Mock; getTimeline: jest.Mock };
  let eventEmitter: jest.Mocked<Partial<EventEmitter2>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryRunner: jest.Mocked<QueryRunner>;

  const userId = 'user-1';
  const adminId = 'admin-1';
  const counterpartyId = 'user-2';
  const userRole = 'user';
  const adminRole = 'admin';

  const mockSignatory: Partial<EscrowSignatory> = {
    id: 'sig-1',
    userId,
    publicKey: 'GCREATORSIGNER1',
    role: SignatoryRole.CREATOR,
    hasApproved: false,
  };

  const mockCounterpartySignatory: Partial<EscrowSignatory> = {
    id: 'sig-2',
    userId: counterpartyId,
    publicKey: 'GCOUNTERPARTYSIGNER1',
    role: SignatoryRole.COUNTERPARTY,
    hasApproved: false,
  };

  const mockEscrow: Partial<EscrowAccount> = {
    id: 'escrow-1',
    creatorId: userId,
    escrowAddress: 'GESCROWADDRESS1',
    type: EscrowType.STANDARD,
    status: EscrowStatus.FUNDED,
    requiredSignatures: 2,
    totalSignatories: 2,
    assetCode: 'USDC',
    assetIssuer: null,
    amount: '1000.0000000',
    releasedAmount: '0.0000000',
    feeAmount: '0.0000000',
    description: 'Test escrow',
    settlementDeadline: new Date(Date.now() + 86400000),
    timeLockExpiry: null,
    metadata: null,
  };

  beforeEach(() => {
    escrowRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => ({ id: 'escrow-1', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => createQueryBuilderMock()),
    };

    signatoryRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        { ...mockSignatory, hasApproved: false },
        { ...mockCounterpartySignatory, hasApproved: false },
      ]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    milestoneRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    timelineService = {
      addEvent: jest.fn().mockResolvedValue({ id: 'timeline-1' }),
      getTimeline: jest.fn().mockResolvedValue([]),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn((entity: any, data: any) => ({
          id: `${entity.name}-1`,
          ...data,
        })),
        save: jest.fn((v: any) => Promise.resolve(v)),
      },
    } as unknown as jest.Mocked<QueryRunner>;

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    service = new EscrowService(
      escrowRepo as never,
      signatoryRepo as never,
      milestoneRepo as never,
      timelineService as never,
      eventEmitter as never,
      dataSource as never,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createEscrow ──────────────────────────────────────────────────────

  describe('createEscrow', () => {
    const createDto = {
      type: EscrowType.STANDARD,
      requiredSignatures: 2,
      assetCode: 'USDC',
      amount: 1000,
      signatories: [
        { userId, publicKey: 'GCREATORSIGNER1', role: SignatoryRole.CREATOR },
        {
          userId: counterpartyId,
          publicKey: 'GCOUNTERPARTYSIGNER1',
          role: SignatoryRole.COUNTERPARTY,
        },
      ],
    };

    it('creates an escrow with m-of-n requirements', async () => {
      const result = await service.createEscrow(userId, userRole, createDto);

      expect(result).toBeDefined();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(timelineService.addEvent).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_CREATED,
        expect.objectContaining({ creatorId: userId }),
      );
    });

    it('rejects when requiredSignatures exceeds signatories count', async () => {
      const dto = { ...createDto, requiredSignatures: 3 };
      await expect(service.createEscrow(userId, userRole, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects TIME_LOCKED escrow without timeLockExpiry', async () => {
      const dto = { ...createDto, type: EscrowType.TIME_LOCKED };
      await expect(service.createEscrow(userId, userRole, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates TIME_LOCKED escrow with timeLockExpiry', async () => {
      const dto = {
        ...createDto,
        type: EscrowType.TIME_LOCKED,
        timeLockExpiry: new Date(Date.now() + 86400000).toISOString(),
      };
      const result = await service.createEscrow(userId, userRole, dto);
      expect(result).toBeDefined();
    });

    it('rejects MILESTONE_BASED escrow without milestones', async () => {
      const dto = { ...createDto, type: EscrowType.MILESTONE_BASED };
      await expect(service.createEscrow(userId, userRole, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects MILESTONE_BASED escrow when milestone amounts dont sum correctly', async () => {
      const dto = {
        ...createDto,
        type: EscrowType.MILESTONE_BASED,
        milestones: [
          { title: 'M1', orderIndex: 0, amount: 300 },
          { title: 'M2', orderIndex: 1, amount: 400 },
        ],
      };
      await expect(service.createEscrow(userId, userRole, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates MILESTONE_BASED escrow with valid milestones', async () => {
      const dto = {
        ...createDto,
        type: EscrowType.MILESTONE_BASED,
        milestones: [
          { title: 'M1', orderIndex: 0, amount: 500 },
          { title: 'M2', orderIndex: 1, amount: 500 },
        ],
      };
      const result = await service.createEscrow(userId, userRole, dto);
      expect(result).toBeDefined();
    });

    it('rolls back transaction on error', async () => {
      (queryRunner.manager.save as jest.Mock).mockRejectedValueOnce(
        new Error('db error'),
      );
      await expect(
        service.createEscrow(userId, userRole, createDto),
      ).rejects.toThrow('db error');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  // ─── getEscrowDetail ──────────────────────────────────────────────────

  describe('getEscrowDetail', () => {
    it('returns escrow details for creator', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getEscrowDetail(
        'escrow-1',
        userId,
        userRole,
      );

      expect(result.escrow).toEqual(mockEscrow);
      expect(result.signatories).toHaveLength(2);
      expect(result.approvalProgress).toBeDefined();
      expect(result.approvalProgress.isThresholdMet).toBe(false);
    });

    it('allows admin access', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getEscrowDetail(
        'escrow-1',
        adminId,
        adminRole,
      );
      expect(result.escrow).toEqual(mockEscrow);
    });

    it('allows signatory access', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getEscrowDetail(
        'escrow-1',
        counterpartyId,
        userRole,
      );
      expect(result.escrow).toEqual(mockEscrow);
    });

    it('rejects unauthorized access', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.getEscrowDetail('escrow-1', 'outsider', userRole),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for missing escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getEscrowDetail('missing', userId, userRole),
      ).rejects.toThrow(NotFoundException);
    });

    it('calculates approval progress correctly', async () => {
      const fundedEscrow = { ...mockEscrow, status: EscrowStatus.FUNDED };
      escrowRepo.findOne.mockResolvedValue(fundedEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true, approvedAt: new Date() },
        { ...mockCounterpartySignatory, hasApproved: false },
      ] as any[]);
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getEscrowDetail(
        'escrow-1',
        userId,
        userRole,
      );
      expect(result.approvalProgress.current).toBe(1);
      expect(result.approvalProgress.required).toBe(2);
      expect(result.approvalProgress.percentage).toBe(50);
      expect(result.approvalProgress.isThresholdMet).toBe(false);
    });

    it('reports threshold met when enough approvals exist', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ] as any[]);
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getEscrowDetail(
        'escrow-1',
        userId,
        userRole,
      );
      expect(result.approvalProgress.isThresholdMet).toBe(true);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('filters by user for non-admin', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, userRole, {
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('escrow.creatorId'),
        { userId },
      );
    });

    it('does not filter by user for admin', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(adminId, adminRole, {
        page: 1,
        limit: 20,
        skip: 0,
      } as never);

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('escrow.creatorId'),
        expect.anything(),
      );
    });

    it('applies status filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, userRole, {
        page: 1,
        limit: 20,
        skip: 0,
        status: EscrowStatus.FUNDED,
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith('escrow.status = :status', {
        status: EscrowStatus.FUNDED,
      });
    });

    it('applies type filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, userRole, {
        page: 1,
        limit: 20,
        skip: 0,
        type: EscrowType.STANDARD,
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith('escrow.type = :type', {
        type: EscrowType.STANDARD,
      });
    });

    it('applies creatorId filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, userRole, {
        page: 1,
        limit: 20,
        skip: 0,
        creatorId: userId,
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'escrow.creatorId = :creatorId',
        {
          creatorId: userId,
        },
      );
    });

    it('applies tradeId filter', async () => {
      const qb = createQueryBuilderMock([], 0);
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll(userId, userRole, {
        page: 1,
        limit: 20,
        skip: 0,
        tradeId: 'trade-1',
      } as never);

      expect(qb.andWhere).toHaveBeenCalledWith('escrow.tradeId = :tradeId', {
        tradeId: 'trade-1',
      });
    });
  });

  // ─── approveEscrow ────────────────────────────────────────────────────

  describe('approveEscrow', () => {
    it('records a signature with timestamp', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: false },
        { ...mockCounterpartySignatory, hasApproved: false },
      ]);

      const result = await service.approveEscrow('escrow-1', userId, {
        note: 'Looks good',
      });

      expect(signatoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hasApproved: true,
          approvedAt: expect.any(Date),
        }),
      );
      expect(timelineService.addEvent).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(String),
        userId,
        expect.stringContaining('Signature recorded'),
        expect.anything(),
      );
    });

    it('rejects approval on non-funded escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(
        service.approveEscrow('escrow-1', userId, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if user is not a signatory', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.approveEscrow('escrow-1', 'outsider', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate approval', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.approveEscrow('escrow-1', userId, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('does not emit threshold event when threshold not yet met', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: false },
        { ...mockCounterpartySignatory, hasApproved: false },
      ]);

      await service.approveEscrow('escrow-1', counterpartyId, {});

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        EscrowEvents.SIGNATURE_THRESHOLD_REACHED,
        expect.anything(),
      );
    });
  });

  // ─── revokeApproval ───────────────────────────────────────────────────

  describe('revokeApproval', () => {
    it('revokes a previous approval', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true, approvedAt: new Date() },
        mockCounterpartySignatory as any,
      ]);

      const result = await service.revokeApproval('escrow-1', userId);

      expect(signatoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          hasApproved: false,
          revokedAt: expect.any(Date),
          approvedAt: null,
        }),
      );
      expect(timelineService.addEvent).toHaveBeenCalled();
    });

    it('rejects revocation on non-funded escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(service.revokeApproval('escrow-1', userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects revocation when not previously approved', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: false },
        mockCounterpartySignatory as any,
      ]);

      await expect(service.revokeApproval('escrow-1', userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects revocation by non-signatory', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.revokeApproval('escrow-1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── fundEscrow ───────────────────────────────────────────────────────

  describe('fundEscrow', () => {
    it('marks escrow as funded with tx hash', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      const result = await service.fundEscrow(
        'escrow-1',
        userId,
        'tx_hash_123',
      );

      expect(result.status).toBe(EscrowStatus.FUNDED);
      expect(result.fundedAt).toBeInstanceOf(Date);
      expect(result.fundingTxHash).toBe('tx_hash_123');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_FUNDED,
        expect.anything(),
      );
    });

    it('rejects funding non-pending escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);

      await expect(
        service.fundEscrow('escrow-1', userId, 'tx_hash'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects funding by non-creator', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(
        service.fundEscrow('escrow-1', counterpartyId, 'tx_hash'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── releaseFunds ─────────────────────────────────────────────────────

  describe('releaseFunds', () => {
    it('releases all funds when threshold met', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.APPROVED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);

      const result = await service.releaseFunds(
        'escrow-1',
        userId,
        userRole,
        {},
      );

      expect(result.status).toBe(EscrowStatus.SETTLED);
      expect(result.settledAt).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_SETTLED,
        expect.anything(),
      );
    });

    it('does partial release when amount specified', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.APPROVED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);

      const result = await service.releaseFunds('escrow-1', userId, userRole, {
        amount: 500,
      });

      expect(result.status).toBe(EscrowStatus.PARTIALLY_RELEASED);
      expect(result.releasedAmount).toBe('500.0000000');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.PARTIAL_RELEASE,
        expect.anything(),
      );
    });

    it('rejects release when threshold not met', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: false },
      ]);

      await expect(
        service.releaseFunds('escrow-1', userId, userRole, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects release on invalid escrow status', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(
        service.releaseFunds('escrow-1', userId, userRole, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects release when amount exceeds remaining', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);

      await expect(
        service.releaseFunds('escrow-1', userId, userRole, { amount: 2000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows admin to force release', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: false },
        { ...mockCounterpartySignatory, hasApproved: false },
      ]);

      const result = await service.releaseFunds(
        'escrow-1',
        adminId,
        adminRole,
        { amount: 1000 },
      );

      expect(result.status).toBe(EscrowStatus.SETTLED);
    });

    it('rejects milestone release when milestone not completed', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);
      milestoneRepo.findOne.mockResolvedValue({
        id: 'milestone-1',
        isCompleted: false,
      } as any);

      await expect(
        service.releaseFunds('escrow-1', userId, userRole, {
          milestoneId: 'milestone-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects release for non-existent milestone', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.APPROVED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(
        service.releaseFunds('escrow-1', userId, userRole, {
          milestoneId: 'non-existent',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows milestone release when milestone completed', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.APPROVED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, hasApproved: true },
        { ...mockCounterpartySignatory, hasApproved: true },
      ]);
      milestoneRepo.findOne.mockResolvedValue({
        id: 'milestone-1',
        isCompleted: true,
        amount: '500.0000000',
      } as any);

      const result = await service.releaseFunds('escrow-1', userId, userRole, {
        milestoneId: 'milestone-1',
        amount: 500,
      });

      expect(result.releasedAmount).toBe('500.0000000');
    });
  });

  // ─── refundEscrow ─────────────────────────────────────────────────────

  describe('refundEscrow', () => {
    it('refunds a pending escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
        releasedAmount: '0.0000000',
      });

      const result = await service.refundEscrow('escrow-1', userId, userRole);

      expect(result.status).toBe(EscrowStatus.REFUNDED);
      expect(result.refundedAt).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_REFUNDED,
        expect.anything(),
      );
    });

    it('refunds an expired escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.EXPIRED,
        releasedAmount: '0.0000000',
      });

      const result = await service.refundEscrow('escrow-1', userId, userRole);
      expect(result.status).toBe(EscrowStatus.REFUNDED);
    });

    it('rejects refund on settled escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.SETTLED,
        releasedAmount: '0.0000000',
      });

      await expect(
        service.refundEscrow('escrow-1', userId, userRole),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects refund from non-creator non-admin', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(
        service.refundEscrow('escrow-1', counterpartyId, userRole),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects refund when amount already released', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
        releasedAmount: '100.0000000',
      });

      await expect(
        service.refundEscrow('escrow-1', userId, userRole),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows admin to refund', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
        releasedAmount: '0.0000000',
      });

      const result = await service.refundEscrow('escrow-1', adminId, adminRole);
      expect(result.status).toBe(EscrowStatus.REFUNDED);
    });
  });

  // ─── handleTimeout ────────────────────────────────────────────────────

  describe('handleTimeout', () => {
    it('expires and refunds escrow after deadline', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
        settlementDeadline: new Date(Date.now() - 1000),
      });

      const result = await service.handleTimeout('escrow-1');

      expect(result.status).toBe(EscrowStatus.REFUNDED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_EXPIRED,
        expect.anything(),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_REFUNDED,
        expect.anything(),
      );
    });

    it('rejects timeout when deadline not passed', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
        settlementDeadline: new Date(Date.now() + 86400000),
      });

      await expect(service.handleTimeout('escrow-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects timeout when no deadline set', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        settlementDeadline: null,
      });

      await expect(service.handleTimeout('escrow-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects timeout on settled escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.SETTLED,
        settlementDeadline: new Date(Date.now() - 1000),
      });

      await expect(service.handleTimeout('escrow-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── handleTimeLockSettlement ─────────────────────────────────────────

  describe('handleTimeLockSettlement', () => {
    it('auto-settles time-locked escrow after expiry', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.TIME_LOCKED,
        status: EscrowStatus.FUNDED,
        timeLockExpiry: new Date(Date.now() - 1000),
        releasedAmount: '0.0000000',
      });

      const result = await service.handleTimeLockSettlement('escrow-1');

      expect(result.status).toBe(EscrowStatus.SETTLED);
      expect(result.settledAt).toBeInstanceOf(Date);
    });

    it('rejects on non-time-locked escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);

      await expect(
        service.handleTimeLockSettlement('escrow-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when time-lock not expired', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.TIME_LOCKED,
        timeLockExpiry: new Date(Date.now() + 86400000),
      });

      await expect(
        service.handleTimeLockSettlement('escrow-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when no timeLockExpiry set', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.TIME_LOCKED,
        timeLockExpiry: null,
      });

      await expect(
        service.handleTimeLockSettlement('escrow-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects on non-settleable status', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.TIME_LOCKED,
        status: EscrowStatus.SETTLED,
        timeLockExpiry: new Date(Date.now() - 1000),
      });

      await expect(
        service.handleTimeLockSettlement('escrow-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('settles partially released time-locked escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.TIME_LOCKED,
        status: EscrowStatus.PARTIALLY_RELEASED,
        timeLockExpiry: new Date(Date.now() - 1000),
        releasedAmount: '500.0000000',
      });

      const result = await service.handleTimeLockSettlement('escrow-1');
      expect(result.status).toBe(EscrowStatus.SETTLED);
      expect(result.releasedAmount).toBe('1000.0000000');
    });
  });

  // ─── updateMilestone ──────────────────────────────────────────────────

  describe('updateMilestone', () => {
    it('completes a milestone and emits event', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);
      milestoneRepo.findOne.mockResolvedValue({
        id: 'milestone-1',
        escrowAccountId: 'escrow-1',
        title: 'Delivery',
        isCompleted: false,
      } as any);

      const result = await service.updateMilestone(
        'escrow-1',
        'milestone-1',
        userId,
        userRole,
        { isCompleted: true },
      );

      expect(result.isCompleted).toBe(true);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.MILESTONE_COMPLETED,
        expect.anything(),
      );
    });

    it('rejects milestone update on non-milestone escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);

      await expect(
        service.updateMilestone('escrow-1', 'milestone-1', userId, userRole, {
          isCompleted: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects milestone update on non-settleable status', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.SETTLED,
      });

      await expect(
        service.updateMilestone('escrow-1', 'milestone-1', userId, userRole, {
          isCompleted: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects milestone update from non-signatory non-admin', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.updateMilestone(
          'escrow-1',
          'milestone-1',
          'outsider',
          userRole,
          {
            isCompleted: true,
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects for non-existent milestone', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);
      milestoneRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateMilestone('escrow-1', 'non-existent', userId, userRole, {
          isCompleted: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows admin to uncomplete a milestone', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.PARTIALLY_RELEASED,
      });
      signatoryRepo.find.mockResolvedValue([]);
      milestoneRepo.findOne.mockResolvedValue({
        id: 'milestone-1',
        escrowAccountId: 'escrow-1',
        isCompleted: true,
        completedAt: new Date(),
      } as any);

      const result = await service.updateMilestone(
        'escrow-1',
        'milestone-1',
        adminId,
        adminRole,
        { isCompleted: false },
      );

      expect(result.isCompleted).toBe(false);
      expect(result.completedAt).toBeNull();
    });

    it('rejects non-signatory non-admin from uncompleting', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        type: EscrowType.MILESTONE_BASED,
        status: EscrowStatus.PARTIALLY_RELEASED,
      });
      signatoryRepo.find.mockResolvedValue([
        { ...mockSignatory, userId: 'other-user' },
      ] as any[]);
      milestoneRepo.findOne.mockResolvedValue({
        id: 'milestone-1',
        isCompleted: true,
      } as any);

      await expect(
        service.updateMilestone('escrow-1', 'milestone-1', userId, userRole, {
          isCompleted: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── flagDispute ──────────────────────────────────────────────────────

  describe('flagDispute', () => {
    it('flags a dispute on a funded escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      const result = await service.flagDispute('escrow-1', userId, {
        reason: 'Seller failed to deliver assets within agreed timeframe.',
        evidence: 'Transaction records show no transfer initiated.',
      });

      expect(result.status).toBe(EscrowStatus.DISPUTED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_DISPUTED,
        expect.anything(),
      );
    });

    it('rejects dispute on non-disputable status', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.SETTLED,
      });

      await expect(
        service.flagDispute('escrow-1', userId, {
          reason: 'Test dispute reason that is long enough to pass validation.',
          evidence: 'Some evidence here.',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dispute from non-party', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.flagDispute('escrow-1', 'outsider', {
          reason: 'Test dispute reason that is long enough.',
          evidence: 'Some evidence here.',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate dispute', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.FUNDED,
        disputeId: 'existing-dispute',
      });
      signatoryRepo.find.mockResolvedValue([
        mockSignatory as any,
        mockCounterpartySignatory as any,
      ]);

      await expect(
        service.flagDispute('escrow-1', userId, {
          reason: 'Test dispute reason that is long enough.',
          evidence: 'Some evidence here.',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── resolveDispute ──────────────────────────────────────────────────

  describe('resolveDispute', () => {
    it('resolves dispute with refund to creator', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.DISPUTED,
      });

      const result = await service.resolveDispute('escrow-1', adminId, true);

      expect(result.status).toBe(EscrowStatus.REFUNDED);
      expect(result.refundedAt).toBeInstanceOf(Date);
    });

    it('resolves dispute with settlement', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.DISPUTED,
      });

      const result = await service.resolveDispute('escrow-1', adminId, false);

      expect(result.status).toBe(EscrowStatus.SETTLED);
      expect(result.settledAt).toBeInstanceOf(Date);
    });

    it('rejects resolving non-disputed escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);

      await expect(
        service.resolveDispute('escrow-1', adminId, true),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── cancelEscrow ─────────────────────────────────────────────────────

  describe('cancelEscrow', () => {
    it('cancels a pending escrow', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      const result = await service.cancelEscrow('escrow-1', userId, userRole);

      expect(result.status).toBe(EscrowStatus.CANCELLED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        EscrowEvents.ESCROW_CANCELLED,
        expect.anything(),
      );
    });

    it('rejects cancelling non-pending escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);

      await expect(
        service.cancelEscrow('escrow-1', userId, userRole),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancellation from non-creator non-admin', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      await expect(
        service.cancelEscrow('escrow-1', counterpartyId, userRole),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows admin to cancel', async () => {
      escrowRepo.findOne.mockResolvedValue({
        ...mockEscrow,
        status: EscrowStatus.PENDING,
      });

      const result = await service.cancelEscrow('escrow-1', adminId, adminRole);
      expect(result.status).toBe(EscrowStatus.CANCELLED);
    });
  });

  // ─── getTimeline ──────────────────────────────────────────────────────

  describe('getTimeline', () => {
    it('returns timeline for valid escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow);
      timelineService.getTimeline.mockResolvedValue([{ id: 'event-1' }] as any);

      const result = await service.getTimeline('escrow-1');

      expect(result).toHaveLength(1);
      expect(timelineService.getTimeline).toHaveBeenCalledWith('escrow-1');
    });

    it('throws for non-existent escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(null);

      await expect(service.getTimeline('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getEscrowOrThrow (indirect via various methods) ──────────────────

  describe('getEscrowOrThrow', () => {
    it('throws NotFoundException for missing escrow', async () => {
      escrowRepo.findOne.mockResolvedValue(null);

      await expect(
        service.fundEscrow('missing', userId, 'tx_hash'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
