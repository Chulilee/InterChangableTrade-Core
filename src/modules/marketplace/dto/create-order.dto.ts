import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { PaginationQueryDto } from '@app/common';
import { OrderType, OrderSide, OrderStatus } from '../entities/order.entity';

/**
 * Request body to create a new order.
 *
 * Supports market, limit, stop-loss and trailing-stop order types.
 */
export class CreateOrderDto {
  @ApiProperty({ example: 'listing-uuid' })
  @IsString()
  @IsNotEmpty()
  listingId: string;

  @ApiProperty({ enum: OrderSide, example: 'buy' })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({ enum: OrderType, example: 'limit' })
  @IsEnum(OrderType)
  orderType: OrderType;

  @ApiProperty({ example: '100.0000000', description: 'Amount offered.' })
  @IsNumberString()
  amount: string;

  /**
   * Limit price (for limit orders) or stop price (for stop-loss orders).
   * Required for limit and stop-loss orders.
   */
  @ApiPropertyOptional({
    example: '1.2500000',
    description: 'Limit or stop price.',
  })
  @IsOptional()
  @IsString()
  price?: string | null;

  /**
   * Trailing percentage (e.g. 5 for 5%) for trailing-stop orders.
   */
  @ApiPropertyOptional({
    example: 5,
    description: 'Trailing stop percentage.',
  })
  @IsOptional()
  @IsString()
  stopPercentage?: string | null;
}

/**
 * Response DTO for an order.
 */
export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  listingId: string;

  @ApiProperty({ enum: OrderType })
  orderType: OrderType;

  @ApiProperty({ enum: OrderSide })
  side: OrderSide;

  @ApiProperty()
  amount: string;

  @ApiPropertyOptional()
  price?: string | null;

  @ApiPropertyOptional()
  stopPrice?: string | null;

  @ApiPropertyOptional()
  stopPercentage?: string | null;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  filledAmount: string;

  @ApiPropertyOptional()
  triggeredAt?: Date | null;

  @ApiPropertyOptional()
  executedAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Query parameters for browsing orders, layered on top of shared pagination.
 */
export class QueryOrderDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderType })
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  listingId?: string;
}
