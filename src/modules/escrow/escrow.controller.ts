import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { ApproveEscrowDto } from './dto/approve-escrow.dto';
import { QueryEscrowDto } from './dto/query-escrow.dto';
import { ReleaseFundsDto } from './dto/release-funds.dto';
import { FlagDisputeDto } from './dto/flag-dispute.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { EscrowAccount } from './entities/escrow-account.entity';

@ApiTags('escrow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  // ─── Create ──────────────────────────────────────────────────────────────

  @Post('accounts')
  @ApiOperation({ summary: 'Create a new multi-sig escrow account' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Escrow account created successfully',
    type: EscrowAccount,
  })
  @HttpCode(HttpStatus.CREATED)
  async createEscrow(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEscrowDto,
  ): Promise<EscrowAccount> {
    return this.escrowService.createEscrow(user.id, user.role, dto);
  }

  // ─── List ────────────────────────────────────────────────────────────────

  @Get('accounts')
  @ApiOperation({
    summary: 'List escrow accounts with filtering and pagination',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryEscrowDto,
  ) {
    return this.escrowService.findAll(user.id, user.role, query);
  }

  // ─── Get Detail ──────────────────────────────────────────────────────────

  @Get('accounts/:id')
  @ApiOperation({
    summary: 'Get escrow account details with signatories and milestones',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.escrowService.getEscrowDetail(id, user.id, user.role);
  }

  // ─── Fund ────────────────────────────────────────────────────────────────

  @Post('accounts/:id/fund')
  @ApiOperation({
    summary: 'Mark an escrow as funded with a Stellar transaction hash',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Escrow funded successfully',
  })
  async fundEscrow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('txHash') txHash: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.fundEscrow(id, user.id, txHash);
  }

  // ─── Approve ─────────────────────────────────────────────────────────────

  @Post('approve/:id')
  @ApiOperation({
    summary: 'Record a signature approval on an escrow account',
    description:
      'A signatory approves the escrow. When the m-of-n threshold is met, the escrow becomes eligible for settlement.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signature recorded with timestamp',
    type: EscrowAccount,
  })
  async approveEscrow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveEscrowDto,
    @Req() req: Request,
  ): Promise<EscrowAccount> {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      undefined;
    return this.escrowService.approveEscrow(id, user.id, dto, ipAddress);
  }

  // ─── Revoke Approval ────────────────────────────────────────────────────

  @Post('revoke/:id')
  @ApiOperation({ summary: 'Revoke a previously given approval' })
  async revokeApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.revokeApproval(id, user.id);
  }

  // ─── Release Funds ───────────────────────────────────────────────────────

  @Post('accounts/:id/release')
  @ApiOperation({
    summary: 'Release funds from escrow (full or partial)',
    description:
      'Releases funds when signature threshold is met. Supports milestone-based partial releases.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Funds released successfully',
    type: EscrowAccount,
  })
  async releaseFunds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseFundsDto,
  ): Promise<EscrowAccount> {
    return this.escrowService.releaseFunds(id, user.id, user.role, dto);
  }

  // ─── Refund ──────────────────────────────────────────────────────────────

  @Post('accounts/:id/refund')
  @ApiOperation({
    summary: 'Refund escrowed funds to creator',
    description:
      'Refunds are only allowed on escrows that have not been partially released.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Escrow refunded',
    type: EscrowAccount,
  })
  async refundEscrow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.refundEscrow(id, user.id, user.role);
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────

  @Post('accounts/:id/cancel')
  @ApiOperation({ summary: 'Cancel a pending escrow (before funding)' })
  async cancelEscrow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.cancelEscrow(id, user.id, user.role);
  }

  // ─── Timeout ─────────────────────────────────────────────────────────────

  @Post('accounts/:id/timeout')
  @ApiOperation({
    summary: 'Trigger timeout on an expired escrow',
    description:
      'If the settlement deadline has passed without sufficient signatures, the escrow expires and funds are auto-refunded.',
  })
  async handleTimeout(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.handleTimeout(id);
  }

  // ─── Time-Lock Settlement ────────────────────────────────────────────────

  @Post('accounts/:id/time-lock-settle')
  @ApiOperation({
    summary: 'Settle a time-locked escrow after expiry',
    description:
      'Automatically settles the escrow when the time-lock has expired.',
  })
  async handleTimeLockSettlement(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EscrowAccount> {
    return this.escrowService.handleTimeLockSettlement(id);
  }

  // ─── Milestone Update ────────────────────────────────────────────────────

  @Post('accounts/:escrowId/milestones/:milestoneId')
  @ApiOperation({
    summary: 'Update milestone completion status',
    description:
      'Mark a milestone as completed (or uncompleted by admin). Completed milestones can trigger partial fund releases.',
  })
  async updateMilestone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('escrowId', ParseUUIDPipe) escrowId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.escrowService.updateMilestone(
      escrowId,
      milestoneId,
      user.id,
      user.role,
      dto,
    );
  }

  // ─── Dispute ─────────────────────────────────────────────────────────────

  @Post('accounts/:id/dispute')
  @ApiOperation({
    summary: 'Flag a dispute on an escrow account',
    description:
      'Freezes the escrow and prevents any further fund movements until the dispute is resolved.',
  })
  async flagDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlagDisputeDto,
  ): Promise<EscrowAccount> {
    return this.escrowService.flagDispute(id, user.id, dto);
  }

  @Post('accounts/:id/resolve-dispute')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ARBITRATOR)
  @ApiOperation({
    summary: 'Resolve a dispute on an escrow account (admin/arbitrator only)',
  })
  async resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('releaseToCreator') releaseToCreator: boolean,
  ): Promise<EscrowAccount> {
    return this.escrowService.resolveDispute(id, user.id, releaseToCreator);
  }

  // ─── Timeline ────────────────────────────────────────────────────────────

  @Get('accounts/:id/timeline')
  @ApiOperation({
    summary: 'Get the audit trail timeline for an escrow account',
  })
  async getTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.escrowService.getTimeline(id);
  }
}
