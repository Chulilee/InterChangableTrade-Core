import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { MultisigAccountService } from './services/multisig-account.service';
import { MultisigTransactionService } from './services/multisig-transaction.service';
import { EnableMultisigDto } from './dto/enable-multisig.dto';
import { RotateKeyDto } from './dto/rotate-key.dto';
import { ProposeMultisigTxDto } from './dto/propose-multisig-tx.dto';
import { AddSignatureDto } from './dto/add-signature.dto';
import { QueryMultisigTxDto } from './dto/query-multisig-tx.dto';

/**
 * Native multi-signature account management and the signing pipeline.
 *
 * Account-config routes build unsigned `SetOptions` transactions (they never
 * sign); the returned XDR is then proposed into the pool and signed through the
 * pipeline routes like any other transaction.
 */
@ApiTags('multisig')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MultisigController {
  constructor(
    private readonly accountService: MultisigAccountService,
    private readonly txService: MultisigTransactionService,
  ) {}

  // ─── Account configuration ─────────────────────────────────────────────────

  @Get('wallets/:walletId/multisig/config')
  @ApiOperation({
    summary: 'Get the on-chain signer set and thresholds for a wallet',
  })
  getConfig(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountService.getOnChainConfig(walletId, user);
  }

  @Post('wallets/:walletId/multisig/setup')
  @ApiOperation({
    summary:
      'Build an unsigned SetOptions transaction to enable M-of-N multisig',
    description:
      'Returns unsigned XDR. Propose it into the signing pool, collect signatures meeting the account’s current authority, then broadcast.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Unsigned XDR built',
  })
  @HttpCode(HttpStatus.CREATED)
  setup(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnableMultisigDto,
  ) {
    return this.accountService.buildEnableMultisigTx(walletId, user, dto);
  }

  @Post('wallets/:walletId/multisig/rotate-key')
  @ApiOperation({
    summary: 'Build an unsigned transaction to rotate a signer key',
    description:
      'Adds the new signer and removes the old one in a single atomic SetOptions transaction — key rotation without account migration.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Unsigned XDR built',
  })
  @HttpCode(HttpStatus.CREATED)
  rotateKey(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RotateKeyDto,
  ) {
    return this.accountService.buildRotateKeyTx(walletId, user, dto);
  }

  // ─── Signing pipeline ──────────────────────────────────────────────────────

  @Post('wallets/:walletId/multisig/transactions')
  @ApiOperation({ summary: 'Propose a transaction into the signing pool' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Transaction pooled, awaiting signatures',
  })
  @HttpCode(HttpStatus.CREATED)
  propose(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposeMultisigTxDto,
  ) {
    return this.txService.propose(walletId, user, dto);
  }

  @Get('wallets/:walletId/multisig/transactions')
  @ApiOperation({
    summary:
      'List a wallet’s pooled transactions (paginated, filter by status)',
  })
  list(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryMultisigTxDto,
  ) {
    return this.txService.list(walletId, user, query);
  }

  @Get('multisig/transactions/:txId')
  @ApiOperation({
    summary: 'Get the partial-signature status of a pooled transaction',
  })
  getStatus(
    @Param('txId', ParseUUIDPipe) txId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.txService.getStatus(txId, user);
  }

  @Post('multisig/transactions/:txId/signatures')
  @ApiOperation({
    summary: 'Add a signature (server-custodied or externally supplied)',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Signature accepted; returns updated status',
  })
  @HttpCode(HttpStatus.CREATED)
  addSignature(
    @Param('txId', ParseUUIDPipe) txId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddSignatureDto,
  ) {
    return this.txService.addSignature(txId, user, dto);
  }

  @Post('multisig/transactions/:txId/broadcast')
  @ApiOperation({
    summary: 'Reassemble the pooled signatures and submit to the network',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Submission attempted' })
  @HttpCode(HttpStatus.OK)
  broadcast(
    @Param('txId', ParseUUIDPipe) txId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.txService.broadcast(txId, user);
  }

  @Post('multisig/transactions/:txId/cancel')
  @ApiOperation({ summary: 'Cancel a pending pooled transaction (owner only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Transaction cancelled' })
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('txId', ParseUUIDPipe) txId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.txService.cancel(txId, user);
  }
}
