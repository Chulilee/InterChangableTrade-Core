import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscrowTimeline } from '../entities/escrow-timeline.entity';
import { EscrowTimelineEventType } from '../enums/escrow-timeline-event-type.enum';

@Injectable()
export class EscrowTimelineService {
  private readonly logger = new Logger(EscrowTimelineService.name);

  constructor(
    @InjectRepository(EscrowTimeline)
    private readonly timelineRepository: Repository<EscrowTimeline>,
  ) {}

  async addEvent(
    escrowAccountId: string,
    eventType: EscrowTimelineEventType,
    actorId: string,
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<EscrowTimeline> {
    const event = this.timelineRepository.create({
      escrowAccountId,
      eventType,
      actorId,
      description,
      metadata,
    });
    const saved = await this.timelineRepository.save(event);
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
