import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  ANALYST = 'analyst',
}

/**
 * Platform user. `stellarPublicKey` links an account to its on-chain identity;
 * `passwordHash` is never returned by the API (see `select: false`).
 */
@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ nullable: true })
  displayName?: string;

  @Index({ unique: true, where: '"stellarPublicKey" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  stellarPublicKey?: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;
}