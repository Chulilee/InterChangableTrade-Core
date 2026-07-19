import { 
  Controller, 
  Get, 
  Post, 
  Param, 
  Body, 
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { StellarApiGatewayService } from './stellar-api-gateway.service';
import { SettlementRequestDto } from './dto/settlement-request.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';

@ApiTags('stellar-gateway')
@Controller('stellar/gateway')
export class StellarGatewayController {
  constructor(private readonly apiGateway: StellarApiGatewayService) {}

  private extractClientId(headers: Record<string, string | undefined>): string {
    return headers['x-client-id'] || 'anonymous';
  }

  @Get('network')
  @ApiOperation({ summary: 'Get configured Stellar network information' })
  @ApiResponse({ status: 200, description: 'Network information retrieved successfully' })
  getNetworkInfo() {
    return this.apiGateway.getNetworkInfo();
  }

  @Get('accounts/:accountId')
  @ApiOperation({ summary: 'Fetch account summary and balances from Stellar network' })
  @ApiHeader({
    name: 'X-Client-ID',
    description: 'Client identifier for rate limiting',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Account information retrieved successfully' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async getAccount(
    @Param('accountId') accountId: string,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const clientId = this.extractClientId(headers);
    const response = await this.apiGateway.getAccount(accountId, clientId);
    
    if (!response.success) {
      throw new HttpException(response.error || 'Unknown error occurred', HttpStatus.SERVICE_UNAVAILABLE);
    }
    
    return response;
  }

  @Post('settle')
  @ApiOperation({ summary: 'Execute a settlement transaction between two accounts' })
  @ApiHeader({
    name: 'X-Client-ID',
    description: 'Client identifier for rate limiting',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Settlement transaction created successfully' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async executeSettlement(
    @Body() settlementRequest: SettlementRequestDto,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const clientId = this.extractClientId(headers);
    const response = await this.apiGateway.executeSettlement(settlementRequest, clientId);
    
    if (!response.success) {
      throw new HttpException(response.error || 'Unknown error occurred', HttpStatus.SERVICE_UNAVAILABLE);
    }
    
    return response;
  }

  @Get('transactions/:hash')
  @ApiOperation({ summary: 'Get transaction details by hash' })
  @ApiHeader({
    name: 'X-Client-ID',
    description: 'Client identifier for rate limiting',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Transaction details retrieved successfully' })
  async getTransaction(
    @Param('hash') hash: string,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const clientId = this.extractClientId(headers);
    const response = await this.apiGateway.getTransaction(hash, clientId);
    
    if (!response.success) {
      throw new HttpException(response.error || 'Unknown error occurred', HttpStatus.SERVICE_UNAVAILABLE);
    }
    
    return response;
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Submit a signed transaction to the Stellar network' })
  @ApiHeader({
    name: 'X-Client-ID',
    description: 'Client identifier for rate limiting',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Transaction submitted successfully' })
  async submitTransaction(
    @Body() submitRequest: SubmitTransactionDto,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const clientId = this.extractClientId(headers);
    const response = await this.apiGateway.submitTransaction(submitRequest.transactionXdr, clientId);
    
    if (!response.success) {
      throw new HttpException(response.error || 'Unknown error occurred', HttpStatus.SERVICE_UNAVAILABLE);
    }
    
    return response;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get gateway performance and usage statistics' })
  @ApiResponse({ status: 200, description: 'Gateway statistics retrieved successfully' })
  getStats() {
    return this.apiGateway.getGatewayStats();
  }
}