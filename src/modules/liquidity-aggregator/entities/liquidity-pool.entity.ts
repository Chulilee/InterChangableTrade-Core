import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum PoolType {
  AMM = 'amm',
  ORDER_BOOK = 'order_book',
  STELLAR_DEX = 'stellar_dex',
}

export enum PoolStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

/**
 * A liquidity pool tracked by the aggregator. Covers AMMs, on-chain order
 * books, and Stellar DEX order books. The `config` JSONB column stores
 * pool-specific parameters (e.g. fee tier for AMM, min order size for OB).
 */
@Entity('liquidity_pools')
export class LiquidityPool extends BaseEntity {
  @Index()
  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: PoolType })
  type: PoolType;

  @Column({ type: 'enum', enum: PoolStatus, default: PoolStatus.ACTIVE })
  status: PoolStatus;

  /** The two assets in this pool (e.g. "XLM" and "USDC"). */
  @Index()
  @Column({ type: 'varchar' })
  assetCodeA: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuerA: string | null;

  @Index()
  @Column({ type: 'varchar' })
  assetCodeB: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuerB: string | null;

  /** Current total value locked in native units of the primary asset. */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: 0 })
  tvl: string;

  /** Fee rate as a decimal (e.g. 0.003 = 0.3%). */
  @Column({ type: 'numeric', precision: 10, scale: 8, default: 0 })
  feeRate: string;

  /** Trading volume in the last 24 hours. */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: 0 })
  volume24h: string;

  /** 24-hour fee revenue. */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: 0 })
  feeRevenue24h: string;

  /** Maximum input size this pool can absorb before excessive slippage. */
  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  maxInputSize: string | null;

  /** On-chain pool address / contract identifier. */
  @Column({ type: 'varchar', nullable: true })
  onChainAddress: string | null;

  /** Last time TVL/volume data was refreshed from on-chain or off-chain. */
  @Column({ type: 'timestamptz', nullable: true })
  lastRefreshedAt: Date | null;

  /** Pool-specific configuration (fee tiers, min sizes, etc.). */
  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any> | null;
}
