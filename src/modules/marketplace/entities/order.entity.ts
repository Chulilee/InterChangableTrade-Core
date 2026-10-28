import {
  Column,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '@app/common';
import { User } from '../../users/entities/user.entity';
import { Listing } from './listing.entity';

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  TRAILING_STOP = 'trailing_stop',
}

export enum OrderStatus {
  PENDING = 'pending',
  TRIGGERED = 'triggered',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

/**
 * An order to buy or sell a listing asset. Supports market, limit,
 * stop-loss and trailing-stop order types with a full lifecycle state
 * machine (pending -> triggered -> filled/cancelled).
 */
@Entity('orders')
export class Order extends BaseEntity {
  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'uuid' })
  @Index()
  listingId: string;

  @Column({
    type: 'enum',
    enum: OrderType,
    default: OrderType.MARKET,
  })
  orderType: OrderType;

  @Column({
    type: 'enum',
    enum: OrderSide,
  })
  side: OrderSide;

  @Column({ type: 'numeric', precision: 20, scale: 7 })
  amount: string;

  /** Limit price (for limit orders) or stop price (for stop-loss orders). */
  @Column({ type: 'numeric', precision: 20, scale: 7, nullable: true })
  price?: string | null;

  /** Trigger price for stop-loss orders. */
  @Column({ type: 'numeric', precision: 20, scale: 7, nullable: true })
  stopPrice?: string | null;

  /** Trailing percentage (e.g. 5 for 5%) for trailing-stop orders. */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  stopPercentage?: string | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  @Index()
  status: OrderStatus;

  @Column({ type: 'numeric', precision: 20, scale: 7, default: '0' })
  filledAmount: string;

  @Column({ type: 'timestamptz', nullable: true })
  triggeredAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt?: Date | null;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Listing, { eager: true })
  @JoinColumn({ name: 'listingId' })
  listing: Listing;
}
