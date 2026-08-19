import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../enums/channel.enum';

@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column('text')
  subject: string;

  @Column('text')
  bodyTemplate: string;

  @Column('text', { nullable: true })
  htmlTemplate: string | null;

  @Column({
    type: 'enum',
    enum: Channel,
    default: Channel.EMAIL,
  })
  channel: Channel;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
