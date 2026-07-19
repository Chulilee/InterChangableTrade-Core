import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  UseGuards, 
  HttpStatus,
  HttpCode
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TradingEngineService } from './trading-engine.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { Order } from './entities/order.entity';
import { PaginatedResultDto } from '@app/common';

@ApiTags('trading-engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trading')
export class TradingEngineController {
  constructor(private readonly tradingEngineService: TradingEngineService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Order created successfully', type: Order })
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @CurrentUser('id') userId: string,
    @Body() createOrderDto: CreateOrderDto
  ): Promise<Order> {
    return this.tradingEngineService.createOrder(userId, createOrderDto);
  }

  @Post('orders/:orderId/cancel')
  @ApiOperation({ summary: 'Cancel an existing order' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Order cancelled successfully', type: Order })
  async cancelOrder(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string
  ): Promise<Order> {
    return this.tradingEngineService.cancelOrder(orderId, userId);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order details by ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Order details retrieved', type: Order })
  async getOrderById(@Param('orderId') orderId: string): Promise<Order> {
    return this.tradingEngineService.getOrderById(orderId);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get orders with filtering and pagination' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Orders retrieved successfully' })
  async getOrders(@Query() queryDto: QueryOrderDto): Promise<PaginatedResultDto<Order>> {
    return this.tradingEngineService.getOrders(queryDto);
  }

  @Post('trades/:tradeId/settle')
  @ApiOperation({ summary: 'Settle a trade on the blockchain' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Trade settled successfully' })
  async settleTrade(@Param('tradeId') tradeId: string) {
    return this.tradingEngineService.settleTrade(tradeId);
  }

  @Get('trades')
  @ApiOperation({ summary: 'Get trade history' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Trade history retrieved' })
  async getTrades(@Query() queryDto: any) {
    return this.tradingEngineService.getTrades(queryDto);
  }
}