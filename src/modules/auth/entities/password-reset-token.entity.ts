import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

/**
 * Single-use token for password reset flow. The `tokenHash` column stores a
 * bcrypt hash; the raw token is sent once via email and must never be logged.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  isUsed: boolean;
}
