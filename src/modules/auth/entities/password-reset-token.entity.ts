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

  /**
   * Deterministic, unique fingerprint of the raw reset token:
   * `HMAC-SHA256(AUTH_TOKEN_PEPPER, rawToken)`. Lets confirmation resolve one
   * row with an indexed lookup before the single bcrypt verification.
   */
  @Index('UQ_password_reset_tokens_lookup_hash', { unique: true })
  @Column({ type: 'char', length: 64, select: false, nullable: true })
  lookupHash?: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  isUsed: boolean;
}
