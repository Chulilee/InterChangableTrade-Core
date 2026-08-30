import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum ArbitrageStatus {
  DETECTED = 'detected',
  SIMULATED = 'simulated',
  EXECUTED = 'executed',
  EXPIRED = 'expired',
  INVALIDATED = 'invalidated',
}

/**
 * A detected arbitrage opportunity spanning two or more pools. Records
 * the full cycle of detection → simulation → execution/expiry.
 */
@Entity('arbitrage_opportunities')
export class ArbitrageOpportunity extends BaseEntity {
  /** The asset pair where arbitrage exists. */
  @Index()
  @Column({ type: 'varchar' })
  baseAsset: string;

  @Column({ type: 'varchar' })
  quoteAsset: string;

  /** Ordered list of pool IDs forming the arbitrage cycle. */
  @Column({ type: 'jsonb' })
  cyclePools: string[];

  /** Theoretical profit in quote asset units. */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  estimatedProfit: string;

  /** Maximum profitable input size before price convergence erases the edge. */
  @Column({ type: 'numeric', precision: 30, scale: 7 })
  maxProfitableSize: string;

  /** Spread percentage that enables the arb (buy low / sell high across pools). */
  @Column({ type: 'numeric', precision: 10, scale: 6 })
  spreadPercent: string;

  /** Estimated gas cost to execute the full cycle. */
  @Column({ type: 'numeric', precision: 20, scale: 0 })
  estimatedGasCost: string;

  @Column({
    type: 'enum',
    enum: ArbitrageStatus,
    default: ArbitrageStatus.DETECTED,
  })
  status: ArbitrageStatus;

  /** When this opportunity was first detected. */
  @Index()
  @Column({ type: 'timestamptz' })
  detectedAt: Date;

  /** TTL — opportunities older than this are pruned. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
