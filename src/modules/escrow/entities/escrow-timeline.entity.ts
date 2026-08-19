import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { EscrowTimelineEventType } from '../enums/escrow-timeline-event-type.enum';

@Entity('escrow_timeline')
export class EscrowTimeline extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  escrowAccountId: string;

  @Column({
    type: 'enum',
    enum: EscrowTimelineEventType,
  })
  eventType: EscrowTimelineEventType;

  /** User who triggered the event */
  @Column({ type: 'uuid' })
  actorId: string;

  /** Human-readable description */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** Additional event-specific data */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
