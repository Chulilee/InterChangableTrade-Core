import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum AuditActionType {
  ORDER_CREATED = 'order_created',
  ORDER_UPDATED = 'order_updated',
  ORDER_CANCELLED = 'order_cancelled',
  TRADE_EXECUTED = 'trade_executed',
  TRADE_SETTLED = 'trade_settled',
  ORDER_REJECTED = 'order_rejected',
}

@Entity('audit_trails')
export class AuditTrail extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar' })
  entityType: string; // 'order' or 'trade'

  @Column({
    type: 'enum',
    enum: AuditActionType,
  })
  action: AuditActionType;

  @Column({ type: 'uuid' })
  actorId: string;

  @Column({ type: 'jsonb' })
  previousState: Record<string, any>;

  @Column({ type: 'jsonb' })
  newState: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}