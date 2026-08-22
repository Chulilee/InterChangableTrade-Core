import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Periodic snapshot of a user's portfolio value. Used for historical
 * performance comparison and charting.
 */
@Entity('portfolio_snapshots')
export class PortfolioSnapshot extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Index()
  @Column({ type: 'timestamptz' })
  snapshotDate: Date;

  /** Total portfolio value in USD at snapshot time. */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  totalValueUsd: string;

  /** Number of distinct assets held at snapshot time. */
  @Column({ type: 'int' })
  assetCount: number;

  /** JSON-encoded breakdown of per-asset holdings at snapshot time. */
  @Column({ type: 'jsonb' })
  holdings: Record<string, string>;
}
