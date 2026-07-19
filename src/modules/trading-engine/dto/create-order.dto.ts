import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsUUID, IsDateString } from 'class-validator';
import { OrderSide, OrderType } from '../entities/order.entity';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ enum: OrderSide })
  @IsEnum(OrderSide)
  @IsNotEmpty()
  side: OrderSide;

  @ApiProperty({ enum: OrderType, default: OrderType.LIMIT })
  @IsEnum(OrderType)
  type: OrderType = OrderType.LIMIT;

  @ApiProperty()
  @IsNotEmpty()
  assetCode: string;

  @ApiProperty({ required: false })
  @IsOptional()
  assetIssuer?: string;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  quantity: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  price?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  metadata?: Record<string, any>;
}