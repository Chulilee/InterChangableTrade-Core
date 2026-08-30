import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Cached optimal route between a token pair. Routes are invalidated when
 * pool state changes significantly (TVL shift > threshold).
 */
@Entity('route_cache')
export class RouteCache extends BaseEntity {
  @Index()
  @Column({ type: 'varchar' })
  tokenIn: string;

  @Index()
  @Column({ type: 'varchar' })
  tokenOut: string;

  /** Ordered list of pool IDs the route traverses. */
  @Column({ type: 'jsonb' })
  poolPath: string[];

  /** Weighted output amount for a reference input size. */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  expectedOutput: string;

  /** Estimated total price impact as a decimal. */
  @Column({ type: 'numeric', precision: 10, scale: 8 })
  priceImpact: string;

  /** Estimated gas cost in stroops. */
  @Column({ type: 'numeric', precision: 20, scale: 0 })
  estimatedGas: string;

  /** Confidence score 0-1 based on pool freshness and liquidity depth. */
  @Column({ type: 'numeric', precision: 5, scale: 4 })
  confidence: string;

  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
