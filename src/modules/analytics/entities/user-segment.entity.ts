import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum SegmentType {
  AUTO = 'auto',
  MANUAL = 'manual',
}

@Entity('user_segments')
export class UserSegment extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 20 })
  segmentType: SegmentType;

  @Column({ type: 'jsonb', nullable: true })
  filterCriteria?: Record<string, any>;

  @Column({ type: 'uuid', array: true, default: [] })
  userIds: string[];

  @Column({ type: 'int', default: 0 })
  userCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastCalculatedAt?: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;
}