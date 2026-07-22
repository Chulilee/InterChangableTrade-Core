import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TradingService } from './trading.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetsService } from '../assets/assets.service';
import { ValidateTradeDto } from './dto/validate-trade.dto';

@ApiTags('trading')
@Controller('trading')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TradingController {
  constructor(
    private readonly tradingService: TradingService,
    private readonly assetsService: AssetsService,
  ) {}

  @Post('validate')
  @ApiOperation({ summary: 'Validate a trade between two assets' })
  async validateTrade(@Body() dto: ValidateTradeDto) {
    const fromAsset = await this.assetsService.findOne(dto.fromAsset);
    const toAsset = await this.assetsService.findOne(dto.toAsset);
    this.tradingService.validateTrade(fromAsset, toAsset);
    return { valid: true };
  }
}
