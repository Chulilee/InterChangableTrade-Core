import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

/**
 * Persisted refresh token. The `tokenHash` field stores a bcrypt hash of the
 * raw token so a database breach does not expose live credentials.
 */
@Index('IDX_refresh_tokens_user_is_revoked', ['userId', 'isRevoked'])
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

  /**
   * Deterministic, unique fingerprint of the raw token:
   * `HMAC-SHA256(AUTH_TOKEN_PEPPER, rawToken)`. bcrypt hashes are salted and
   * cannot be queried by equality, so this column is what lets
   * `refreshAccessToken` resolve a single row with one indexed lookup instead
   * of running `bcrypt.compare` against every live session.
   */
  @Index('UQ_refresh_tokens_lookup_hash', { unique: true })
  @Column({ type: 'char', length: 64, select: false, nullable: true })
  lookupHash?: string | null;

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
