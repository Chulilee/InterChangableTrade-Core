import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/common';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REJECTED = 'rejected',
}

@Entity('orders')
export class Order extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Index()
  @Column({ type: 'varchar' })
  assetCode: string;

  @Column({ type: 'varchar', nullable: true })
  assetIssuer?: string | null;

  @Column({
    type: 'enum',
    enum: OrderSide,
  })
  side: OrderSide;

  @Column({
    type: 'enum',
    enum: OrderType,
    default: OrderType.LIMIT,
  })
  type: OrderType;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  quantity: string;

  @Column({ type: 'numeric', precision: 30, scale: 7 })
  filledQuantity: string = '0';

  @Column({ type: 'numeric', precision: 30, scale: 7, nullable: true })
  price?: string | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
