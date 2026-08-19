import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { Channel } from '../enums/channel.enum';
import { NotificationType } from '../enums/notification-type.enum';

@Entity('notification_preferences')
@Unique(['userId', 'channel'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: Channel,
  })
  channel: Channel;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({
    type: 'enum',
    enum: NotificationType,
    array: true,
    default: Object.values(NotificationType),
  })
  subscribedTypes: NotificationType[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
