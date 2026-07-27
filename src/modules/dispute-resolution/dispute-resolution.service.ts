import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaginatedResultDto } from '@app/common';
import { Dispute } from './entities/dispute.entity';
import { DisputeTimeline } from './entities/dispute-timeline.entity';
import { DisputeMessage } from './entities/dispute-message.entity';
import { DisputeStatus } from './enums/dispute-status.enum';
import { TimelineEventType } from './enums/timeline-event-type.enum';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { QueryDisputeDto } from './dto/query-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { AppealDisputeDto } from './dto/appeal-dispute.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { DisputeEvidenceService } from './services/dispute-evidence.service';
import { ArbitratorService } from './services/arbitrator.service';
import { DisputePatternDetectionService } from './services/dispute-pattern-detection.service';
import { DisputeEnforcementService } from './services/dispute-enforcement.service';
import { DisputeEvents } from './events/dispute.events';
import {
  INITIAL_REVIEW_SLA_HOURS,
  RESOLUTION_SLA_DAYS,
  MAX_DISPUTES_PER_USER_PER_MONTH,
} from './constants/dispute.constants';
import { Trade } from '../trading-engine/entities/trade.entity';
import { UserRole } from '../users/entities/user.entity';
import { UploadedFilePayload } from './types/uploaded-file.type';

export interface DisputeDetailResponse {
  dispute: Dispute;
  evidence: Awaited<ReturnType<DisputeEvidenceService['findByDispute']>>;
  timeline: DisputeTimeline[];
  messages: DisputeMessage[];
  slaStatus: {
    initialReviewDeadline: Date;
    resolutionDeadline: Date;
    initialReviewOverdue: boolean;
    resolutionOverdue: boolean;
    initialReviewCompleted: boolean;
  };
}

@Injectable()
export class DisputeResolutionService {
  private readonly logger = new Logger(DisputeResolutionService.name);

  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(DisputeTimeline)
    private readonly timelineRepository: Repository<DisputeTimeline>,
    @InjectRepository(DisputeMessage)
    private readonly messageRepository: Repository<DisputeMessage>,
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly evidenceService: DisputeEvidenceService,
    private readonly arbitratorService: ArbitratorService,
    private readonly patternDetectionService: DisputePatternDetectionService,
    private readonly enforcementService: DisputeEnforcementService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private calculateSlaDeadlines(): {
    initialReviewDeadline: Date;
    resolutionDeadline: Date;
  } {
    const now = new Date();
    const initialReviewDeadline = new Date(
      now.getTime() + INITIAL_REVIEW_SLA_HOURS * 60 * 60 * 1000,
    );
    const resolutionDeadline = new Date(
      now.getTime() + RESOLUTION_SLA_DAYS * 24 * 60 * 60 * 1000,
    );
    return { initialReviewDeadline, resolutionDeadline };
  }

  private async addTimelineEvent(
    disputeId: string,
    eventType: TimelineEventType,
    actorId: string,
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<DisputeTimeline> {
    const event = this.timelineRepository.create({
      disputeId,
      eventType,
      actorId,
      description,
      metadata,
    });
    return this.timelineRepository.save(event);
  }

  private assertPartyAccess(
    dispute: Dispute,
    userId: string,
    userRole: string,
  ): void {
    const isParty =
      dispute.complainantId === userId || dispute.respondentId === userId;
    const isStaff =
      userRole === UserRole.ADMIN ||
      userRole === UserRole.ARBITRATOR ||
      userRole === UserRole.ANALYST;

    if (!isParty && !isStaff) {
      throw new ForbiddenException('You do not have access to this dispute');
    }
  }

  async checkFrivolousDisputeProtection(userId: string): Promise<void> {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const recentCount = await this.disputeRepository.count({
      where: {
        complainantId: userId,
        createdAt: MoreThan(oneMonthAgo),
      },
    });

    if (recentCount >= MAX_DISPUTES_PER_USER_PER_MONTH) {
      throw new BadRequestException(
        `Maximum of ${MAX_DISPUTES_PER_USER_PER_MONTH} disputes per month exceeded. Contact support if you believe this is an error.`,
      );
    }
  }

  async createDispute(userId: string, dto: CreateDisputeDto): Promise<Dispute> {
    await this.checkFrivolousDisputeProtection(userId);

    const trade = await this.tradeRepository.findOne({
      where: { id: dto.tradeId },
    });
    if (!trade) {
      throw new NotFoundException(`Trade ${dto.tradeId} not found`);
    }

    const isParty =
      trade.makerUserId === userId || trade.takerUserId === userId;
    if (!isParty) {
      throw new ForbiddenException(
        'Only trade participants can file a dispute',
      );
    }

    const existingDispute = await this.disputeRepository.findOne({
      where: {
        tradeId: dto.tradeId,
        complainantId: userId,
      },
    });
    if (existingDispute && existingDispute.status !== DisputeStatus.REJECTED) {
      throw new BadRequestException(
        'An active dispute already exists for this trade',
      );
    }

    const respondentId =
      trade.makerUserId === userId ? trade.takerUserId : trade.makerUserId;

    const sla = this.calculateSlaDeadlines();

    const dispute = this.disputeRepository.create({
      tradeId: dto.tradeId,
      complainantId: userId,
      respondentId,
      classification: dto.classification,
      description: dto.description,
      status: DisputeStatus.FILED,
      initialReviewDeadline: sla.initialReviewDeadline,
      resolutionDeadline: sla.resolutionDeadline,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.disputeRepository.save(dispute);

    await this.addTimelineEvent(
      saved.id,
      TimelineEventType.DISPUTE_FILED,
      userId,
      `Dispute filed: ${dto.classification}`,
    );

    await this.patternDetectionService.flagIfSimilar(saved);

    const arbitrator = await this.arbitratorService.assignArbitrator(
      dto.classification,
    );
    if (arbitrator) {
      saved.arbitratorId = arbitrator.userId;
      saved.status = DisputeStatus.UNDER_REVIEW;
      await this.disputeRepository.save(saved);

      await this.addTimelineEvent(
        saved.id,
        TimelineEventType.ARBITRATOR_ASSIGNED,
        arbitrator.userId,
        `Arbitrator assigned based on ${dto.classification} expertise`,
      );

      this.eventEmitter.emit(DisputeEvents.ARBITRATOR_ASSIGNED, {
        disputeId: saved.id,
        arbitratorId: arbitrator.userId,
      });
    }

    this.eventEmitter.emit(DisputeEvents.DISPUTE_CREATED, {
      disputeId: saved.id,
      complainantId: userId,
      respondentId,
    });

    return saved;
  }

  async findOne(
    id: string,
    userId: string,
    userRole: string,
  ): Promise<DisputeDetailResponse> {
    const dispute = await this.disputeRepository.findOne({ where: { id } });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${id} not found`);
    }

    this.assertPartyAccess(dispute, userId, userRole);

    const now = new Date();
    const evidence = await this.evidenceService.findByDispute(id);
    const timeline = await this.timelineRepository.find({
      where: { disputeId: id },
      order: { createdAt: 'ASC' },
    });
    const messages = await this.messageRepository.find({
      where: { disputeId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      dispute,
      evidence,
      timeline,
      messages: messages.filter(
        (m) =>
          !m.isInternal ||
          userRole === UserRole.ADMIN ||
          userRole === UserRole.ARBITRATOR,
      ),
      slaStatus: {
        initialReviewDeadline: dispute.initialReviewDeadline,
        resolutionDeadline: dispute.resolutionDeadline,
        initialReviewOverdue:
          !dispute.initialReviewCompletedAt &&
          now > dispute.initialReviewDeadline,
        resolutionOverdue:
          !dispute.resolvedAt && now > dispute.resolutionDeadline,
        initialReviewCompleted: !!dispute.initialReviewCompletedAt,
      },
    };
  }

  async findAll(
    userId: string,
    userRole: string,
    query: QueryDisputeDto,
  ): Promise<PaginatedResultDto<Dispute>> {
    const qb = this.disputeRepository
      .createQueryBuilder('dispute')
      .orderBy('dispute.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    const isStaff =
      userRole === UserRole.ADMIN ||
      userRole === UserRole.ARBITRATOR ||
      userRole === UserRole.ANALYST;

    if (!isStaff) {
      qb.andWhere(
        '(dispute.complainantId = :userId OR dispute.respondentId = :userId)',
        { userId },
      );
    }

    if (query.status) {
      qb.andWhere('dispute.status = :status', { status: query.status });
    }
    if (query.classification) {
      qb.andWhere('dispute.classification = :classification', {
        classification: query.classification,
      });
    }
    if (query.tradeId) {
      qb.andWhere('dispute.tradeId = :tradeId', { tradeId: query.tradeId });
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResultDto(data, total, query.page, query.limit);
  }

  async submitEvidence(
    disputeId: string,
    userId: string,
    userRole: string,
    file: UploadedFilePayload,
    description?: string,
  ) {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    this.assertPartyAccess(dispute, userId, userRole);

    const terminalStatuses = [
      DisputeStatus.RESOLVED,
      DisputeStatus.CLOSED,
      DisputeStatus.REJECTED,
    ];
    if (terminalStatuses.includes(dispute.status)) {
      throw new BadRequestException(
        'Cannot submit evidence on a closed dispute',
      );
    }

    const evidence = await this.evidenceService.saveEvidence(
      disputeId,
      userId,
      file,
      description,
    );

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.EVIDENCE_SUBMITTED,
      userId,
      `Evidence submitted: ${file.originalname}`,
      { evidenceId: evidence.id },
    );

    if (dispute.status === DisputeStatus.FILED) {
      dispute.status = DisputeStatus.INVESTIGATION;
      dispute.initialReviewCompletedAt = new Date();
      await this.disputeRepository.save(dispute);

      await this.addTimelineEvent(
        disputeId,
        TimelineEventType.STATUS_CHANGED,
        userId,
        'Status changed to investigation',
        { from: DisputeStatus.FILED, to: DisputeStatus.INVESTIGATION },
      );
    }

    return evidence;
  }

  async sendMessage(
    disputeId: string,
    userId: string,
    userRole: string,
    dto: CreateMessageDto,
  ): Promise<DisputeMessage> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    this.assertPartyAccess(dispute, userId, userRole);

    if (
      dto.isInternal &&
      userRole !== UserRole.ADMIN &&
      userRole !== UserRole.ARBITRATOR
    ) {
      throw new ForbiddenException('Only staff can send internal messages');
    }

    const message = this.messageRepository.create({
      disputeId,
      senderId: userId,
      content: dto.content,
      isInternal: dto.isInternal ?? false,
    });

    const saved = await this.messageRepository.save(message);

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.MESSAGE_SENT,
      userId,
      'Message sent',
    );

    return saved;
  }

  async resolveDispute(
    disputeId: string,
    actorId: string,
    actorRole: string,
    dto: ResolveDisputeDto,
  ): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    if (actorRole === UserRole.ARBITRATOR && dispute.arbitratorId !== actorId) {
      throw new ForbiddenException(
        'Arbitrators can only resolve disputes assigned to them',
      );
    }

    const resolvableStatuses = [
      DisputeStatus.UNDER_REVIEW,
      DisputeStatus.INVESTIGATION,
      DisputeStatus.ARBITRATION,
      DisputeStatus.APPEALED,
    ];
    if (!resolvableStatuses.includes(dispute.status)) {
      throw new BadRequestException(
        `Cannot resolve dispute in status: ${dispute.status}`,
      );
    }

    const previousStatus = dispute.status;
    dispute.status = DisputeStatus.RESOLVED;
    dispute.resolutionType = dto.resolutionType;
    dispute.decisionReasoning = dto.decisionReasoning;
    dispute.resolutionAmount = dto.resolutionAmount ?? null;
    dispute.resolvedAt = new Date();

    if (!dispute.initialReviewCompletedAt) {
      dispute.initialReviewCompletedAt = new Date();
    }

    const saved = await this.disputeRepository.save(dispute);

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.DECISION_MADE,
      actorId,
      `Dispute resolved: ${dto.resolutionType}`,
      { resolutionType: dto.resolutionType, reasoning: dto.decisionReasoning },
    );

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.STATUS_CHANGED,
      actorId,
      `Status changed from ${previousStatus} to resolved`,
      { from: previousStatus, to: DisputeStatus.RESOLVED },
    );

    if (dispute.arbitratorId) {
      await this.arbitratorService.releaseArbitrator(dispute.arbitratorId);
    }

    await this.enforcementService.executeEnforcement(saved);

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.ENFORCEMENT_EXECUTED,
      actorId,
      'Resolution enforcement executed',
    );

    this.eventEmitter.emit(DisputeEvents.DISPUTE_RESOLVED, {
      disputeId: saved.id,
      resolutionType: dto.resolutionType,
      complainantId: saved.complainantId,
      respondentId: saved.respondentId,
    });

    return saved;
  }

  async appealDispute(
    disputeId: string,
    userId: string,
    dto: AppealDisputeDto,
  ): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    if (dispute.complainantId !== userId && dispute.respondentId !== userId) {
      throw new ForbiddenException('Only dispute parties can file an appeal');
    }

    if (dispute.status !== DisputeStatus.RESOLVED) {
      throw new BadRequestException(
        'Appeals can only be filed on resolved disputes',
      );
    }

    if (dispute.appealed) {
      throw new BadRequestException('Only one appeal is allowed per dispute');
    }

    dispute.appealed = true;
    dispute.status = DisputeStatus.APPEALED;
    dispute.enforcementExecuted = false;
    dispute.metadata = {
      ...dispute.metadata,
      appealReason: dto.appealReason,
      appealedAt: new Date().toISOString(),
      appealedBy: userId,
    };

    const saved = await this.disputeRepository.save(dispute);

    await this.addTimelineEvent(
      disputeId,
      TimelineEventType.APPEAL_FILED,
      userId,
      'Appeal filed',
      { reason: dto.appealReason },
    );

    const arbitrator = await this.arbitratorService.assignArbitrator(
      dispute.classification,
    );
    if (arbitrator) {
      saved.arbitratorId = arbitrator.userId;
      saved.status = DisputeStatus.ARBITRATION;
      await this.disputeRepository.save(saved);

      await this.addTimelineEvent(
        disputeId,
        TimelineEventType.ARBITRATOR_ASSIGNED,
        arbitrator.userId,
        'New arbitrator assigned for appeal',
      );
    }

    this.eventEmitter.emit(DisputeEvents.DISPUTE_APPEALED, {
      disputeId: saved.id,
      appealedBy: userId,
    });

    return saved;
  }

  async getTimeline(
    disputeId: string,
    userId: string,
    userRole: string,
  ): Promise<DisputeTimeline[]> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    this.assertPartyAccess(dispute, userId, userRole);

    return this.timelineRepository.find({
      where: { disputeId },
      order: { createdAt: 'ASC' },
    });
  }
}
