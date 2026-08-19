import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Keypair } from '@stellar/stellar-sdk';
import { PaginatedResultDto } from '@app/common';
import { EscrowAccount } from './entities/escrow-account.entity';
import { EscrowSignatory } from './entities/escrow-signatory.entity';
import { EscrowMilestone } from './entities/escrow-milestone.entity';
import { EscrowStatus } from './enums/escrow-status.enum';
import { EscrowType } from './enums/escrow-type.enum';
import { EscrowTimelineEventType } from './enums/escrow-timeline-event-type.enum';
import { EscrowTimelineService } from './services/escrow-timeline.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { ApproveEscrowDto } from './dto/approve-escrow.dto';
import { QueryEscrowDto } from './dto/query-escrow.dto';
import { ReleaseFundsDto } from './dto/release-funds.dto';
import { FlagDisputeDto } from './dto/flag-dispute.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { EscrowEvents } from './events/escrow.events';
import {
  DEFAULT_SETTLEMENT_WINDOW_MS,
  MAX_ACTIVE_ESCROWS_PER_USER,
} from './constants/escrow.constants';

export interface EscrowDetailResponse {
  escrow: EscrowAccount;
  signatories: EscrowSignatory[];
  milestones: EscrowMilestone[];
  approvalProgress: {
    current: number;
    required: number;
    percentage: number;
    isThresholdMet: boolean;
  };
}

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectRepository(EscrowAccount)
    private readonly escrowRepo: Repository<EscrowAccount>,
    @InjectRepository(EscrowSignatory)
    private readonly signatoryRepo: Repository<EscrowSignatory>,
    @InjectRepository(EscrowMilestone)
    private readonly milestoneRepo: Repository<EscrowMilestone>,
    private readonly timelineService: EscrowTimelineService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getEscrowOrThrow(id: string): Promise<EscrowAccount> {
    const escrow = await this.escrowRepo.findOne({ where: { id } });
    if (!escrow) {
      throw new NotFoundException(`Escrow account ${id} not found`);
    }
    return escrow;
  }

  private assertCreatorOrAdmin(
    escrow: EscrowAccount,
    userId: string,
    userRole: string,
  ): void {
    if (escrow.creatorId !== userId && userRole !== 'admin') {
      throw new ForbiddenException('Only the creator or an admin can perform this action');
    }
  }

  private assertSignatory(
    signatories: EscrowSignatory[],
    userId: string,
  ): EscrowSignatory {
    const signatory = signatories.find((s) => s.userId === userId);
    if (!signatory) {
      throw new ForbiddenException('You are not a signatory on this escrow');
    }
    return signatory;
  }

  private calculateApprovalProgress(
    signatories: EscrowSignatory[],
    requiredSignatures: number,
  ) {
    const approvedCount = signatories.filter((s) => s.hasApproved).length;
    return {
      current: approvedCount,
      required: requiredSignatures,
      percentage: Math.round((approvedCount / requiredSignatures) * 100),
      isThresholdMet: approvedCount >= requiredSignatures,
    };
  }

  // ─── Create Escrow ───────────────────────────────────────────────────────

  async createEscrow(
    userId: string,
    userRole: string,
    dto: CreateEscrowDto,
  ): Promise<EscrowAccount> {
    // Validate m-of-n: requiredSignatures <= total signatories
    if (dto.requiredSignatures > dto.signatories.length) {
      throw new BadRequestException(
        `requiredSignatures (${dto.requiredSignatures}) cannot exceed the number of signatories (${dto.signatories.length})`,
      );
    }

    // Validate time-lock expiry is provided for TIME_LOCKED type
    if (dto.type === EscrowType.TIME_LOCKED && !dto.timeLockExpiry) {
      throw new BadRequestException(
        'timeLockExpiry is required for TIME_LOCKED escrow type',
      );
    }

    // Validate milestones for MILESTONE_BASED type
    if (dto.type === EscrowType.MILESTONE_BASED) {
      if (!dto.milestones || dto.milestones.length === 0) {
        throw new BadRequestException(
          'At least one milestone is required for MILESTONE_BASED escrow type',
        );
      }
      const milestoneTotal = dto.milestones.reduce(
        (sum: number, m) => sum + m.amount,
        0,
      );
      if (Math.abs(milestoneTotal - dto.amount) > 0.0000001) {
        throw new BadRequestException(
          `Milestone amounts (${milestoneTotal}) must sum to the escrow amount (${dto.amount})`,
        );
      }
    }

    // Check active escrow limit
    const activeCount = await this.escrowRepo.count({
      where: {
        creatorId: userId,
        status: EscrowStatus.PENDING,
      },
    });
    if (activeCount >= MAX_ACTIVE_ESCROWS_PER_USER) {
      throw new BadRequestException(
        `Maximum of ${MAX_ACTIVE_ESCROWS_PER_USER} active escrows exceeded`,
      );
    }

    // Generate a Stellar escrow keypair (for on-chain multisig setup)
    const escrowKeypair = Keypair.random();
    const totalSignatories = dto.signatories.length;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create escrow account
      const escrow = queryRunner.manager.create(EscrowAccount, {
        creatorId: userId,
        escrowAddress: escrowKeypair.publicKey(),
        type: dto.type,
        status: EscrowStatus.PENDING,
        requiredSignatures: dto.requiredSignatures,
        totalSignatories,
        assetCode: dto.assetCode,
        assetIssuer: dto.assetIssuer ?? null,
        amount: dto.amount.toString(),
        description: dto.description ?? null,
        tradeId: dto.tradeId ?? null,
        settlementDeadline: dto.settlementDeadline
          ? new Date(dto.settlementDeadline)
          : dto.settlementDeadline === undefined
            ? new Date(Date.now() + DEFAULT_SETTLEMENT_WINDOW_MS)
            : null,
        timeLockExpiry: dto.timeLockExpiry
          ? new Date(dto.timeLockExpiry)
          : null,
        metadata: dto.metadata ?? null,
      });

      const savedEscrow = await queryRunner.manager.save(escrow);

      // Create signatory records
      const signatories = dto.signatories.map((s) =>
        queryRunner.manager.create(EscrowSignatory, {
          escrowAccountId: savedEscrow.id,
          userId: s.userId,
          publicKey: s.publicKey,
          role: s.role,
          hasApproved: false,
        }),
      );
      await queryRunner.manager.save(signatories);

      // Create milestones if provided
      if (dto.milestones && dto.milestones.length > 0) {
        const milestones = dto.milestones.map((m) =>
          queryRunner.manager.create(EscrowMilestone, {
            escrowAccountId: savedEscrow.id,
            title: m.title,
            description: m.description ?? null,
            orderIndex: m.orderIndex,
            amount: m.amount.toString(),
            isCompleted: false,
          }),
        );
        await queryRunner.manager.save(milestones);
      }

      await queryRunner.commitTransaction();

      // Timeline and events outside transaction
      await this.timelineService.addEvent(
        savedEscrow.id,
        EscrowTimelineEventType.ESCROW_CREATED,
        userId,
        `Escrow created: ${dto.amount} ${dto.assetCode} (${dto.type})`,
        { type: dto.type, amount: dto.amount, assetCode: dto.assetCode },
      );

      this.eventEmitter.emit(EscrowEvents.ESCROW_CREATED, {
        escrowId: savedEscrow.id,
        creatorId: userId,
        type: dto.type,
      });

      this.logger.log(`Escrow ${savedEscrow.id} created by ${userId}`);
      return savedEscrow;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Get Escrow Details ──────────────────────────────────────────────────

  async getEscrowDetail(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<EscrowDetailResponse> {
    const escrow = await this.getEscrowOrThrow(id);

    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: id },
    });

    // Only creator, signatories, or admins can view details
    const isSignatory = signatories.some((s) => s.userId === userId);
    if (escrow.creatorId !== userId && !isSignatory && userRole !== 'admin') {
      throw new ForbiddenException('You do not have access to this escrow');
    }

    const milestones = await this.milestoneRepo.find({
      where: { escrowAccountId: id },
      order: { orderIndex: 'ASC' },
    });

    const approvalProgress = this.calculateApprovalProgress(
      signatories,
      escrow.requiredSignatures,
    );

    return { escrow, signatories, milestones, approvalProgress };
  }

  // ─── List Escrows ────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    userRole: string,
    query: QueryEscrowDto,
  ): Promise<PaginatedResultDto<EscrowAccount>> {
    const qb = this.escrowRepo
      .createQueryBuilder('escrow')
      .orderBy('escrow.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    // Non-admins only see escrows they created or are a signatory on
    if (userRole !== 'admin') {
      qb.andWhere(
        '(escrow.creatorId = :userId OR escrow.id IN (SELECT s.escrowAccountId FROM escrow_signatories s WHERE s.userId = :userId))',
        { userId },
      );
    }

    if (query.status) {
      qb.andWhere('escrow.status = :status', { status: query.status });
    }
    if (query.type) {
      qb.andWhere('escrow.type = :type', { type: query.type });
    }
    if (query.creatorId) {
      qb.andWhere('escrow.creatorId = :creatorId', {
        creatorId: query.creatorId,
      });
    }
    if (query.tradeId) {
      qb.andWhere('escrow.tradeId = :tradeId', { tradeId: query.tradeId });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page ?? 1, query.limit ?? 20);
  }

  // ─── Approve Escrow ──────────────────────────────────────────────────────

  async approveEscrow(
    escrowId: string,
    userId: string,
    dto: ApproveEscrowDto,
    ipAddress?: string,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    // Can only approve funded escrows
    if (escrow.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(
        `Cannot approve escrow in status: ${escrow.status}. Must be in FUNDED status.`,
      );
    }

    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: escrowId },
    });

    const signatory = this.assertSignatory(signatories, userId);

    // Check if already approved
    if (signatory.hasApproved) {
      throw new ConflictException('You have already approved this escrow');
    }

    // Record approval
    signatory.hasApproved = true;
    signatory.approvedAt = new Date();
    signatory.approvalIpAddress = ipAddress ?? null;
    await this.signatoryRepo.save(signatory);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.SIGNATORY_APPROVED,
      userId,
      `Signature recorded from ${signatory.role}${dto.note ? ': ' + dto.note : ''}`,
      { signatoryRole: signatory.role, publicKey: signatory.publicKey },
    );

    // Check if threshold is now met
    const approvalProgress = this.calculateApprovalProgress(
      signatories,
      escrow.requiredSignatures,
    );

    if (approvalProgress.isThresholdMet) {
      await this.timelineService.addEvent(
        escrowId,
        EscrowTimelineEventType.SIGNATURE_THRESHOLD_REACHED,
        userId,
        `Signature threshold reached: ${approvalProgress.current}/${approvalProgress.required}`,
      );

      this.eventEmitter.emit(EscrowEvents.SIGNATURE_THRESHOLD_REACHED, {
        escrowId: escrow.id,
        currentSignatures: approvalProgress.current,
        requiredSignatures: approvalProgress.required,
      });
    }

    this.logger.log(
      `Escrow ${escrowId} approved by ${userId} (${approvalProgress.current}/${approvalProgress.required})`,
    );

    // Return updated escrow
    return this.escrowRepo.findOne({ where: { id: escrowId } }) as Promise<EscrowAccount>;
  }

  // ─── Revoke Approval ─────────────────────────────────────────────────────

  async revokeApproval(escrowId: string, userId: string): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(
        `Cannot revoke approval on escrow in status: ${escrow.status}`,
      );
    }

    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: escrowId },
    });

    const signatory = this.assertSignatory(signatories, userId);

    if (!signatory.hasApproved) {
      throw new BadRequestException('You have not approved this escrow');
    }

    signatory.hasApproved = false;
    signatory.revokedAt = new Date();
    signatory.approvedAt = null;
    await this.signatoryRepo.save(signatory);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.SIGNATORY_REVOKED,
      userId,
      `Signature revoked by ${signatory.role}`,
    );

    this.logger.log(`Escrow ${escrowId} approval revoked by ${userId}`);
    return this.escrowRepo.findOne({ where: { id: escrowId } }) as Promise<EscrowAccount>;
  }

  // ─── Fund Escrow ─────────────────────────────────────────────────────────

  async fundEscrow(
    escrowId: string,
    userId: string,
    txHash: string,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(
        `Cannot fund escrow in status: ${escrow.status}`,
      );
    }

    if (escrow.creatorId !== userId) {
      throw new ForbiddenException('Only the creator can fund the escrow');
    }

    escrow.status = EscrowStatus.FUNDED;
    escrow.fundedAt = new Date();
    escrow.fundingTxHash = txHash;

    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.ESCROW_FUNDED,
      userId,
      `Escrow funded: ${escrow.amount} ${escrow.assetCode}`,
      { txHash },
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_FUNDED, {
      escrowId: escrow.id,
      amount: escrow.amount,
      assetCode: escrow.assetCode,
    });

    this.logger.log(`Escrow ${escrowId} funded by ${userId}`);
    return saved;
  }

  // ─── Release / Settle ────────────────────────────────────────────────────

  async releaseFunds(
    escrowId: string,
    userId: string,
    userRole: string,
    dto: ReleaseFundsDto,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    const releasableStatuses = [
      EscrowStatus.APPROVED,
      EscrowStatus.PARTIALLY_RELEASED,
    ];

    // Admin can force release, otherwise threshold must be met
    const isForceRelease = userRole === 'admin';
    if (!isForceRelease && !releasableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot release funds from escrow in status: ${escrow.status}`,
      );
    }

    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: escrowId },
    });

    const approvalProgress = this.calculateApprovalProgress(
      signatories,
      escrow.requiredSignatures,
    );

    if (!isForceRelease && !approvalProgress.isThresholdMet) {
      throw new BadRequestException(
        `Signature threshold not yet met (${approvalProgress.current}/${approvalProgress.required})`,
      );
    }

    // Determine release amount
    const remaining = parseFloat(escrow.amount) - parseFloat(escrow.releasedAmount);
    const releaseAmount = dto.amount ?? remaining;

    if (releaseAmount <= 0 || releaseAmount > remaining + 0.0000001) {
      throw new BadRequestException(
        `Invalid release amount: ${releaseAmount}. Remaining: ${remaining}`,
      );
    }

    // Milestone-based release
    if (dto.milestoneId) {
      const milestone = await this.milestoneRepo.findOne({
        where: { id: dto.milestoneId, escrowAccountId: escrowId },
      });
      if (!milestone) {
        throw new NotFoundException(`Milestone ${dto.milestoneId} not found`);
      }
      if (!milestone.isCompleted) {
        throw new BadRequestException('Milestone must be completed before releasing funds');
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newReleasedAmount =
        parseFloat(escrow.releasedAmount) + releaseAmount;
      const isFullySettled =
        Math.abs(newReleasedAmount - parseFloat(escrow.amount)) < 0.0000001;

      escrow.releasedAmount = newReleasedAmount.toFixed(7);

      if (isFullySettled) {
        escrow.status = EscrowStatus.SETTLED;
        escrow.settledAt = new Date();
        escrow.settlementTxHash = `settlement_${Date.now()}`;

        await this.timelineService.addEvent(
          escrowId,
          EscrowTimelineEventType.ESCROW_SETTLED,
          userId,
          `Escrow fully settled: ${escrow.amount} ${escrow.assetCode}`,
          { releasedAmount: escrow.releasedAmount },
        );

        this.eventEmitter.emit(EscrowEvents.ESCROW_SETTLED, {
          escrowId: escrow.id,
          totalReleased: escrow.releasedAmount,
        });
      } else {
        escrow.status = EscrowStatus.PARTIALLY_RELEASED;

        await this.timelineService.addEvent(
          escrowId,
          EscrowTimelineEventType.PARTIAL_RELEASE,
          userId,
          `Partial release: ${releaseAmount} ${escrow.assetCode}`,
          {
            releaseAmount,
            totalReleased: escrow.releasedAmount,
            remaining: (remaining - releaseAmount).toFixed(7),
          },
        );

        this.eventEmitter.emit(EscrowEvents.PARTIAL_RELEASE, {
          escrowId: escrow.id,
          releaseAmount,
          totalReleased: escrow.releasedAmount,
        });
      }

      const saved = await queryRunner.manager.save(escrow);
      await queryRunner.commitTransaction();

      this.logger.log(
        `Escrow ${escrowId}: released ${releaseAmount} ${escrow.assetCode} (total: ${escrow.releasedAmount})`,
      );
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Refund ──────────────────────────────────────────────────────────────

  async refundEscrow(
    escrowId: string,
    userId: string,
    userRole: string,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    const refundableStatuses = [
      EscrowStatus.PENDING,
      EscrowStatus.AWAITING_FUNDING,
      EscrowStatus.FUNDED,
      EscrowStatus.EXPIRED,
    ];

    if (!refundableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot refund escrow in status: ${escrow.status}`,
      );
    }

    // Creator or admin can refund
    if (escrow.creatorId !== userId && userRole !== 'admin') {
      throw new ForbiddenException('Only the creator or an admin can refund');
    }

    // If funded, must check if any amount was already released
    if (parseFloat(escrow.releasedAmount) > 0) {
      throw new BadRequestException(
        'Cannot refund escrow with partially released funds. Use releaseFunds for remaining.',
      );
    }

    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundedAt = new Date();
    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.ESCROW_REFUNDED,
      userId,
      `Escrow refunded: ${escrow.amount} ${escrow.assetCode}`,
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_REFUNDED, {
      escrowId: escrow.id,
      amount: escrow.amount,
      refundTo: escrow.creatorId,
    });

    this.logger.log(`Escrow ${escrowId} refunded by ${userId}`);
    return saved;
  }

  // ─── Timeout / Expiry ────────────────────────────────────────────────────

  async handleTimeout(escrowId: string): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    // Only process escrows that are past their deadline
    if (!escrow.settlementDeadline) {
      throw new BadRequestException('Escrow has no settlement deadline');
    }

    if (new Date() < escrow.settlementDeadline) {
      throw new BadRequestException('Escrow deadline has not passed yet');
    }

    const timeoutableStatuses = [
      EscrowStatus.PENDING,
      EscrowStatus.AWAITING_FUNDING,
      EscrowStatus.FUNDED,
    ];

    if (!timeoutableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot timeout escrow in status: ${escrow.status}`,
      );
    }

    escrow.status = EscrowStatus.EXPIRED;
    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.TIMEOUT_TRIGGERED,
      escrow.creatorId,
      `Settlement deadline expired without sufficient signatures`,
      { deadline: escrow.settlementDeadline },
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_EXPIRED, {
      escrowId: escrow.id,
      deadline: escrow.settlementDeadline,
    });

    // Auto-refund expired escrows
    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundedAt = new Date();
    const refunded = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.ESCROW_REFUNDED,
      escrow.creatorId,
      `Automatic refund triggered by timeout`,
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_REFUNDED, {
      escrowId: escrow.id,
      amount: escrow.amount,
      refundTo: escrow.creatorId,
    });

    this.logger.log(`Escrow ${escrowId} timed out and refunded`);
    return refunded;
  }

  // ─── Time-Lock Auto-Settlement ───────────────────────────────────────────

  async handleTimeLockSettlement(escrowId: string): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.type !== EscrowType.TIME_LOCKED) {
      throw new BadRequestException('This is not a time-locked escrow');
    }

    if (!escrow.timeLockExpiry) {
      throw new BadRequestException('Escrow has no time-lock expiry');
    }

    if (new Date() < escrow.timeLockExpiry) {
      throw new BadRequestException('Time-lock has not expired yet');
    }

    const settleableStatuses = [
      EscrowStatus.FUNDED,
      EscrowStatus.PARTIALLY_RELEASED,
    ];

    if (!settleableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot settle time-locked escrow in status: ${escrow.status}`,
      );
    }

    // Auto-settle: release remaining funds to creator
    const remaining = parseFloat(escrow.amount) - parseFloat(escrow.releasedAmount);

    escrow.releasedAmount = escrow.amount;
    escrow.status = EscrowStatus.SETTLED;
    escrow.settledAt = new Date();
    escrow.settlementTxHash = `timelock_settlement_${Date.now()}`;

    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.ESCROW_SETTLED,
      escrow.creatorId,
      `Time-lock expired. Auto-settled: ${escrow.amount} ${escrow.assetCode}`,
      { timeLockExpiry: escrow.timeLockExpiry, releasedAmount: remaining },
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_SETTLED, {
      escrowId: escrow.id,
      totalReleased: escrow.amount,
      autoSettled: true,
    });

    this.logger.log(
      `Escrow ${escrowId} auto-settled via time-lock expiry`,
    );
    return saved;
  }

  // ─── Milestone Management ────────────────────────────────────────────────

  async updateMilestone(
    escrowId: string,
    milestoneId: string,
    userId: string,
    userRole: string,
    dto: UpdateMilestoneDto,
  ): Promise<EscrowMilestone> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.type !== EscrowType.MILESTONE_BASED) {
      throw new BadRequestException('This escrow does not support milestones');
    }

    const releasableStatuses = [
      EscrowStatus.FUNDED,
      EscrowStatus.APPROVED,
      EscrowStatus.PARTIALLY_RELEASED,
    ];
    if (!releasableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot update milestones on escrow in status: ${escrow.status}`,
      );
    }

    // Only signatories or admins can update milestones
    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: escrowId },
    });
    const isSignatory = signatories.some((s) => s.userId === userId);
    if (!isSignatory && userRole !== 'admin') {
      throw new ForbiddenException('Only signatories or admins can update milestones');
    }

    const milestone = await this.milestoneRepo.findOne({
      where: { id: milestoneId, escrowAccountId: escrowId },
    });
    if (!milestone) {
      throw new NotFoundException(`Milestone ${milestoneId} not found`);
    }

    if (dto.isCompleted && !milestone.isCompleted) {
      milestone.isCompleted = true;
      milestone.completedAt = new Date();
      milestone.completedBy = userId;

      await this.timelineService.addEvent(
        escrowId,
        EscrowTimelineEventType.MILESTONE_COMPLETED,
        userId,
        `Milestone completed: ${milestone.title} (${milestone.amount} ${escrow.assetCode})`,
        { milestoneId, amount: milestone.amount },
      );

      this.eventEmitter.emit(EscrowEvents.MILESTONE_COMPLETED, {
        escrowId: escrow.id,
        milestoneId: milestone.id,
        amount: milestone.amount,
        completedBy: userId,
      });
    } else if (!dto.isCompleted && milestone.isCompleted) {
      // Allow uncompleting a milestone (admin action)
      if (userRole !== 'admin') {
        throw new ForbiddenException('Only admins can uncomplete milestones');
      }
      milestone.isCompleted = false;
      milestone.completedAt = null;
      milestone.completedBy = null;
    }

    return this.milestoneRepo.save(milestone);
  }

  // ─── Dispute ─────────────────────────────────────────────────────────────

  async flagDispute(
    escrowId: string,
    userId: string,
    dto: FlagDisputeDto,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    const disputableStatuses = [
      EscrowStatus.FUNDED,
      EscrowStatus.APPROVED,
      EscrowStatus.PARTIALLY_RELEASED,
    ];
    if (!disputableStatuses.includes(escrow.status)) {
      throw new BadRequestException(
        `Cannot raise dispute on escrow in status: ${escrow.status}`,
      );
    }

    // Only signatories or creator can raise disputes
    const signatories = await this.signatoryRepo.find({
      where: { escrowAccountId: escrowId },
    });
    const isParty =
      escrow.creatorId === userId ||
      signatories.some((s) => s.userId === userId);
    if (!isParty) {
      throw new ForbiddenException('Only escrow parties can raise a dispute');
    }

    if (escrow.disputeId) {
      throw new ConflictException('A dispute is already active on this escrow');
    }

    escrow.status = EscrowStatus.DISPUTED;
    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.DISPUTE_FLAGGED,
      userId,
      `Dispute raised: ${dto.reason}`,
      { reason: dto.reason, evidence: dto.evidence },
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_DISPUTED, {
      escrowId: escrow.id,
      flaggedBy: userId,
      reason: dto.reason,
    });

    this.logger.log(`Escrow ${escrowId} dispute raised by ${userId}`);
    return saved;
  }

  async resolveDispute(
    escrowId: string,
    userId: string,
    releaseToCreator: boolean,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.status !== EscrowStatus.DISPUTED) {
      throw new BadRequestException(
        `Cannot resolve dispute on escrow in status: ${escrow.status}`,
      );
    }

    escrow.status = releaseToCreator
      ? EscrowStatus.REFUNDED
      : EscrowStatus.SETTLED;
    escrow.refundedAt = releaseToCreator ? new Date() : null;
    escrow.settledAt = releaseToCreator ? null : new Date();
    escrow.disputeId = null;

    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.DISPUTE_RESOLVED,
      userId,
      `Dispute resolved: funds ${releaseToCreator ? 'refunded to creator' : 'settled'}`,
      { releasedToCreator: releaseToCreator },
    );

    this.logger.log(
      `Escrow ${escrowId} dispute resolved by ${userId} (release to creator: ${releaseToCreator})`,
    );
    return saved;
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────

  async cancelEscrow(
    escrowId: string,
    userId: string,
    userRole: string,
  ): Promise<EscrowAccount> {
    const escrow = await this.getEscrowOrThrow(escrowId);

    if (escrow.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(
        `Cannot cancel escrow in status: ${escrow.status}`,
      );
    }

    this.assertCreatorOrAdmin(escrow, userId, userRole);

    escrow.status = EscrowStatus.CANCELLED;
    const saved = await this.escrowRepo.save(escrow);

    await this.timelineService.addEvent(
      escrowId,
      EscrowTimelineEventType.ESCROW_CANCELLED,
      userId,
      'Escrow cancelled',
    );

    this.eventEmitter.emit(EscrowEvents.ESCROW_CANCELLED, {
      escrowId: escrow.id,
      cancelledBy: userId,
    });

    this.logger.log(`Escrow ${escrowId} cancelled by ${userId}`);
    return saved;
  }

  // ─── Timeline ────────────────────────────────────────────────────────────

  async getTimeline(escrowId: string) {
    await this.getEscrowOrThrow(escrowId);
    return this.timelineService.getTimeline(escrowId);
  }
}
