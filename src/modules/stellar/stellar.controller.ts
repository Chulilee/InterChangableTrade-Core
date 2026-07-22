import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StellarService } from './stellar.service';
import { SorobanService } from './soroban.service';
import { InvokeContractDto } from './dto/invoke-contract.dto';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    private readonly stellarService: StellarService,
    private readonly sorobanService: SorobanService,
  ) {}

  @Get('network')
  @ApiOperation({ summary: 'Get the configured Stellar network info' })
  getNetwork() {
    return this.stellarService.getNetworkInfo();
  }

  @Get('accounts/:accountId')
  @ApiOperation({
    summary: 'Fetch an account summary and balances from Horizon',
  })
  getAccount(@Param('accountId') accountId: string) {
    return this.stellarService.getAccount(accountId);
  }

  @Get('soroban/network')
  @ApiOperation({ summary: 'Get the configured Soroban RPC network info' })
  getSorobanNetwork() {
    return this.sorobanService.getNetworkInfo();
  }

  @Post('soroban/simulate')
  @ApiOperation({ summary: 'Simulate a read-only Soroban contract call' })
  simulate(@Body() dto: InvokeContractDto) {
    return this.sorobanService.simulate(dto.contractId, dto.method);
  }
}
