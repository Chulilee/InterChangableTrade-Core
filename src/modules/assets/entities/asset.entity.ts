import { Column, Entity, Index, Unique, ManyToOne } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum AssetStatus {
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
}

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

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  imageUrl?: string;

  @Column({ type: 'enum', enum: AssetStatus, default: AssetStatus.ACTIVE })
  status: AssetStatus;

  @Column({ default: true })
  isTradeable: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deprecationDate?: Date;

  @ManyToOne(() => Asset, { nullable: true })
  migratedTo?: Asset;

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
