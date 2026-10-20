import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { EscrowTimeline } from '../entities/escrow-timeline.entity';
import { EscrowTimelineEventType } from '../enums/escrow-timeline-event-type.enum';

@Injectable()
export class EscrowTimelineService {
  private readonly logger = new Logger(EscrowTimelineService.name);

  constructor(
    @InjectRepository(EscrowTimeline)
    private readonly timelineRepository: Repository<EscrowTimeline>,
  ) {}

  /**
   * Records a timeline event. Pass a transactional `manager` to make the write
   * commit atomically with the operation that produced it (e.g. the escrow
   * status transition in `approveEscrow` / `releaseFunds`).
   */
  async addEvent(
    escrowAccountId: string,
    eventType: EscrowTimelineEventType,
    actorId: string,
    description?: string,
    metadata?: Record<string, any>,
    manager?: EntityManager,
  ): Promise<EscrowTimeline> {
    const repository = manager
      ? manager.getRepository(EscrowTimeline)
      : this.timelineRepository;
    const event = repository.create({
      escrowAccountId,
      eventType,
      actorId,
      description,
      metadata,
    });
    const saved = await repository.save(event);
    this.logger.debug(
      `Timeline event ${eventType} added for escrow ${escrowAccountId}`,
    );
    return saved;
  }

  async getTimeline(escrowAccountId: string): Promise<EscrowTimeline[]> {
    return this.timelineRepository.find({
      where: { escrowAccountId },
      order: { createdAt: 'ASC' },
    });
  }
}
