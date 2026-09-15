import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { DeliveryStatus } from '../enums/delivery-status.enum';

@Entity('notifications')
@Index(['recipient', 'createdAt'])
@Index(['recipient', 'isRead'])
@Index(['recipient', 'type'])
@Index(['scheduledAt', 'deliveryStatus'])
@Index(['batchId'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  recipient: string;

  @Column({
    type: 'enum',
    enum: Channel,
  })
  channel: Channel;

  @Column({
    type: 'enum',
    enum: NotificationType,
    default: NotificationType.SYSTEM_NOTICE,
  })
  type: NotificationType;

  @Column({ length: 255, nullable: true })
  title: string;

  @Column('text')
  message: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @Column({ default: false })
  isRead: boolean;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
  })
  deliveryStatus: DeliveryStatus;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  batchId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
