import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { MultisigConfigDto } from './dto/multisig-config.dto';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new Stellar wallet for the authenticated user',
  })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateWalletDto) {
    return this.walletService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all wallets for the authenticated user (paginated)',
  })
  findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.walletService.findAllForUser(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific wallet by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update wallet label, status, or primary flag' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletService.update(id, userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a wallet (non-primary wallets only)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletService.remove(id, userId);
  }

  @Post(':id/sync-balance')
  @ApiOperation({
    summary: 'Synchronise wallet balance from the Stellar network',
  })
  syncBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletService.syncBalance(id, userId);
  }

  @Post(':id/sign-transaction')
  @ApiOperation({
    summary: 'Sign an XDR transaction envelope with this wallet',
    description:
      'Only operations on the configured allowlist are signed. setOptions and accountMerge additionally require the admin role and a step-up token from POST /auth/step-up, supplied in the x-step-up-token header.',
  })
  @ApiHeader({
    name: 'x-step-up-token',
    description:
      'Short-lived step-up token, required when the envelope contains setOptions or accountMerge',
    required: false,
  })
  signTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SignTransactionDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    return this.walletService.signTransaction(id, user.id, dto, {
      role: user.role,
      stepUpToken,
    });
  }

  @Get(':id/public-key')
  @ApiOperation({ summary: 'Retrieve the public key for account recovery' })
  getPublicKey(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletService.getPublicKey(id, userId);
  }

  @Patch(':id/multisig')
  @ApiOperation({ summary: 'Configure multi-signature settings for a wallet' })
  configureMultisig(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MultisigConfigDto,
  ) {
    return this.walletService.configureMultisig(id, userId, dto);
  }
}
