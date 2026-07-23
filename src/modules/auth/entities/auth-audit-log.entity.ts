import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

export enum AuthEventType {
  REGISTER = 'register',
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_REVOKED = 'token_revoked',
  PASSWORD_RESET_REQUEST = 'password_reset_request',
  PASSWORD_RESET_SUCCESS = 'password_reset_success',
  API_KEY_CREATED = 'api_key_created',
  API_KEY_REVOKED = 'api_key_revoked',
  STELLAR_AUTH_CHALLENGE = 'stellar_auth_challenge',
  STELLAR_AUTH_SUCCESS = 'stellar_auth_success',
  STELLAR_AUTH_FAILED = 'stellar_auth_failed',
  OAUTH_LOGIN_SUCCESS = 'oauth_login_success',
  ACCOUNT_LOCKED = 'account_locked',
}

/**
 * Immutable audit record for every authentication event. The `userId` column
 * is nullable so failed pre-authentication attempts (e.g., unknown email) can
 * still be recorded without a user FK.
 */
@Entity('auth_audit_logs')
export class AuthAuditLog extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Index()
  @Column({ nullable: true })
  userId?: string;

  @Index()
  @Column({ type: 'enum', enum: AuthEventType })
  eventType: AuthEventType;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  /** Extra contextual data (e.g., which API key was used, OAuth provider). */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  /** Whether the action was successful. Derived from event type but stored for fast querying. */
  @Column({ default: true })
  success: boolean;

  @Column({ nullable: true })
  failureReason?: string;
}
