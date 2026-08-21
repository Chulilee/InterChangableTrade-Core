import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';
import { RateLimitTier } from '../enums/rate-limit.enum';

/**
 * Stores per-tier and per-endpoint rate limit overrides.
 * Admin endpoints can read/write these at runtime without restarts.
 */
@Entity('rate_limit_configs')
export class RateLimitConfig extends BaseEntity {
  /** Which tier this configuration applies to. */
  @Index({ unique: true })
  @Column({ type: 'enum', enum: RateLimitTier, unique: true })
  tier: RateLimitTier;

  /** Maximum number of requests allowed in the window. */
  @Column({ type: 'int', default: 100 })
  maxRequests: number;

  /** Window size in seconds. */
  @Column({ type: 'int', default: 60 })
  windowSizeSeconds: number;

  /** Optional endpoint-specific pattern (e.g. '/api/trading/*'). Empty means global. */
  @Column({ type: 'varchar', nullable: true })
  endpointPattern?: string | null;

  /** Whether this tier is currently enabled. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;
}
