import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

@Entity('trades')
export class Trade extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  makerOrderId: string;

  @Index()
  @Column({ type: 'uuid' })
  takerOrderId: string;

  @Index()
  @Column({ type: 'uuid' })
  makerUserId: string;

  @Index()
  @Column({ type: 'uuid' })
  takerUserId: string;

  @Column({ type: 'varchar' })
  assetCode: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string | null;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  quantity: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  price: string;

  @Column({ type: 'varchar', nullable: true })
  stellarTxHash?: string | null;

  @Column({ type: 'boolean', default: false })
  settled: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt?: Date | null;
}
