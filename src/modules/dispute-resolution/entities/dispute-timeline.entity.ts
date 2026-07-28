import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { TimelineEventType } from '../enums/timeline-event-type.enum';

@Entity('dispute_timeline')
export class DisputeTimeline extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  disputeId: string;

  @Column({
    type: 'enum',
    enum: TimelineEventType,
  })
  eventType: TimelineEventType;

  @Column({ type: 'uuid' })
  actorId: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
