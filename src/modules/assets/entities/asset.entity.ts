import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@app/common';

/**
 * An indexed Stellar asset. Native XLM is represented with `issuer = null`.
 * The (code, issuer) pair is unique — it is the canonical asset identity on
 * the Stellar network.
 */
@Entity('assets')
@Unique('UQ_asset_code_issuer', ['code', 'issuer'])
export class Asset extends BaseEntity {
  @Index()
  @Column()
  code: string;

  @Column({ type: 'varchar', nullable: true })
  issuer?: string | null;

  @Column({ default: false })
  isNative: boolean;

  @Column({ nullable: true })
  domain?: string;

  /** Number of holders/trustlines observed at the last index pass. */
  @Column({ type: 'bigint', default: 0 })
  holders: string;

  /** Total supply observed at the last index pass. */
  @Column({ type: 'numeric', precision: 30, scale: 7, default: 0 })
  totalSupply: string;

  @Column({ type: 'boolean', default: true })
  isVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastIndexedAt?: Date | null;
}
