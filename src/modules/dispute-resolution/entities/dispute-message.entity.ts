import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

@Entity('dispute_messages')
export class DisputeMessage extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  disputeId: string;

  @Index()
  @Column({ type: 'uuid' })
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'boolean', default: false })
  isInternal: boolean;
}
