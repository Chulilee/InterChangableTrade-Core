import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

/**
 * Persisted refresh token. The `tokenHash` field stores a bcrypt hash of the
 * raw token so a database breach does not expose live credentials.
 */
@Entity('refresh_tokens')
export class RefreshToken extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  /** bcrypt hash of the raw refresh token value. */
  @Column()
  tokenHash: string;

  /** Human-readable hint for the client (browser, mobile, api-client, …). */
  @Column({ nullable: true })
  deviceHint?: string;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set to true on explicit logout or rotation. */
  @Column({ default: false })
  isRevoked: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  revokedAt?: Date;
}
