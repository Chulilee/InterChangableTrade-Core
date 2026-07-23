import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

/**
 * API key for programmatic access. Only the bcrypt hash is stored in the
 * database; the plain key is shown once at creation time.
 */
@Entity('api_keys')
export class ApiKey extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column({ unique: true })
  name: string;

  /** Stores bcrypt hash of the key; raw key never persisted. */
  @Column({ select: false })
  keyHash: string;

  /** Optional prefix shown in UI (e.g., last 8 chars of raw key). */
  @Column({ nullable: true })
  keyPreview?: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  /**
   * Optional scope limitation for this key (e.g., read-only or
   * specific resource namespaces). Stored as JSON.
   */
  @Column({ type: 'jsonb', nullable: true })
  scopes?: string[];
}
