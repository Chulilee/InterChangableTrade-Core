import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * Point-in-time snapshot of a pool's state, used for time-series analytics,
 * price history, and TVL trend analysis.
 */
@Entity('pool_snapshots')
export class PoolSnapshot extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  poolId: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  tvl: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  volume24h: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  feeRevenue24h: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  reserveA: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  reserveB: string;

  /** Spot price of asset B denominated in asset A at snapshot time. */
  @Column({ type: 'numeric', precision: 30, scale: 10 })
  spotPrice: string;

  @Column({ type: 'numeric', precision: 10, scale: 8 })
  feeRate: string;

  @Index()
  @Column({ type: 'timestamptz' })
  snapshotAt: Date;
}
