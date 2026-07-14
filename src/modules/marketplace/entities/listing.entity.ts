import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';

export enum ListingStatus {
  ACTIVE = 'active',
  SOLD = 'sold',
  CANCELLED = 'cancelled',
}

/**
 * A marketplace offer to trade a Stellar asset. `assetCode`/`assetIssuer`
 * identify the asset (issuer is null for native XLM); `price` is denominated
 * in `priceAssetCode`.
 */
@Entity('listings')
export class Listing extends BaseEntity {
  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @Column()
  assetCode: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 7 })
  amount: string;

  @Column({ type: 'numeric', precision: 20, scale: 7 })
  price: string;

  @Column({ default: 'XLM' })
  priceAssetCode: string;

  @Index()
  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.ACTIVE })
  status: ListingStatus;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sellerId' })
  seller: User;

  @Index()
  @Column()
  sellerId: string;
}
