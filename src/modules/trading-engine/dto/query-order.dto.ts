import { IsEnum, IsOptional, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, OrderSide } from '../entities/order.entity';
import { PaginationQueryDto } from '@app/common';

export class QueryOrderDto extends PaginationQueryDto {
  @ApiProperty({ enum: OrderStatus, required: false })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiProperty({ enum: OrderSide, required: false })
  @IsOptional()
  @IsEnum(OrderSide)
  side?: OrderSide;

  @ApiProperty({ required: false })
  @IsOptional()
  assetCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  fromDate?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  toDate?: Date;
}