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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransactionCoordinatorService } from './services/transaction-coordinator.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { QueryBatchDto } from './dto/query-batch.dto';
import { TransactionBatch } from './entities/transaction-batch.entity';
import { BatchAuditLog } from './entities/batch-audit-log.entity';
import { PaginatedResultDto } from '@app/common';

@ApiTags('transaction-coordinator')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('coordinator')
export class TransactionCoordinatorController {
  constructor(
    private readonly coordinatorService: TransactionCoordinatorService,
  ) {}

  // ─── Create Batch ─────────────────────────────────────────────────────

  @Post('batches')
  @ApiOperation({ summary: 'Create a new atomic swap batch' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Batch created successfully',
    type: TransactionBatch,
  })
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBatchDto,
  ): Promise<TransactionBatch> {
    return this.coordinatorService.createBatch(userId, dto);
  }

  // ─── Execute Batch ────────────────────────────────────────────────────

  @Post('batches/:id/execute')
  @ApiOperation({
    summary: 'Execute a batch through the full two-phase commit lifecycle',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch executed (committed or rolled back)',
  })
  async executeBatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.coordinatorService.executeBatch(id);
  }

  // ─── Prepare Batch (Manual 2PC) ──────────────────────────────────────

  @Post('batches/:id/prepare')
  @ApiOperation({
    summary: 'Prepare a batch without committing (manual two-phase commit)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch prepared',
    type: TransactionBatch,
  })
  async prepareBatch(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionBatch> {
    return this.coordinatorService.prepareBatch(id);
  }

  // ─── Commit Batch (Manual 2PC) ───────────────────────────────────────

  @Post('batches/:id/commit')
  @ApiOperation({
    summary: 'Commit a previously prepared batch',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch committed',
  })
  async commitBatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.coordinatorService.commitBatch(id);
  }

  // ─── Cancel Batch ─────────────────────────────────────────────────────

  @Post('batches/:id/cancel')
  @ApiOperation({ summary: 'Cancel a batch that has not been committed' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch cancelled and rolled back',
    type: TransactionBatch,
  })
  async cancelBatch(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransactionBatch> {
    return this.coordinatorService.cancelBatch(id, userId);
  }

  // ─── Get Batch Detail ─────────────────────────────────────────────────

  @Get('batches/:id')
  @ApiOperation({
    summary: 'Get detailed batch info including legs and execution graph',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch details retrieved',
  })
  async getBatchDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.coordinatorService.getBatchDetail(id);
  }

  // ─── List Batches ─────────────────────────────────────────────────────

  @Get('batches')
  @ApiOperation({ summary: 'List batches with filtering and pagination' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batches retrieved',
  })
  async listBatches(
    @CurrentUser('id') userId: string,
    @Query() query: QueryBatchDto,
  ): Promise<PaginatedResultDto<TransactionBatch>> {
    return this.coordinatorService.listBatches(userId, query);
  }

  // ─── Audit Trail ──────────────────────────────────────────────────────

  @Get('batches/:id/audit')
  @ApiOperation({ summary: 'Get the complete audit trail for a batch' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Audit trail retrieved',
    type: [BatchAuditLog],
  })
  async getAuditTrail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BatchAuditLog[]> {
    return this.coordinatorService.getAuditTrail(id);
  }

  // ─── Statistics ───────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get coordinator statistics for monitoring' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statistics retrieved',
  })
  async getStatistics() {
    return this.coordinatorService.getStatistics();
  }
}
