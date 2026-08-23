import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  UseGuards,
  HttpStatus,
  HttpCode,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BlockchainIndexerService } from './blockchain-indexer.service';
import { LedgerIndexerService } from './services/ledger-indexer.service';
import { EventQueryService } from './services/event-query.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { TemporalQueryDto } from './dto/subscribe-events.dto';
import { PaginatedResultDto } from '@app/common';
import { BlockchainEvent } from './entities/blockchain-event.entity';
import { IndexedEvent } from './entities/indexed-event.entity';
import { Response } from 'express';

@ApiTags('blockchain-indexer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blockchain-indexer')
export class BlockchainIndexerController {
  constructor(
    private readonly blockchainIndexerService: BlockchainIndexerService,
    private readonly ledgerIndexerService: LedgerIndexerService,
    private readonly queryService: EventQueryService,
  ) {}

  // ─── Legacy event queries ───────────────────────────────────────

  @Get('events')
  @ApiOperation({ summary: 'Query indexed blockchain events with filtering' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Events retrieved successfully',
  })
  async getEvents(@Query() queryDto: QueryEventsDto) {
    const result = await this.queryService.findEvents({
      ...queryDto,
      skip: queryDto.skip,
      startTime: queryDto.startTime ? new Date(queryDto.startTime) : undefined,
      endTime: queryDto.endTime ? new Date(queryDto.endTime) : undefined,
      excludeInvalidated: true,
    });
    return new PaginatedResultDto<BlockchainEvent>(
      result.events,
      result.total,
      queryDto.page,
      queryDto.limit,
    );
  }

  @Get('events/:transactionHash')
  @ApiOperation({ summary: 'Get all events for a specific transaction' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transaction events retrieved',
  })
  async getEventsByTransaction(
    @Param('transactionHash') transactionHash: string,
  ): Promise<BlockchainEvent[]> {
    return this.queryService.findByTransactionHash(transactionHash);
  }

  // ─── Real-time indexer endpoints ────────────────────────────────

  @Get('realtime/status')
  @ApiOperation({
    summary: 'Get real-time ledger indexer status, metrics, and health',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Real-time indexer status',
  })
  async getRealtimeStatus() {
    return this.ledgerIndexerService.getStatus();
  }

  @Get('realtime/events')
  @ApiOperation({
    summary:
      'Query indexed events from the real-time pipeline with filtering',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Events retrieved successfully',
  })
  async getRealtimeEvents(@Query() queryDto: QueryEventsDto) {
    const result = await this.queryService.findEvents({
      ...queryDto,
      skip: queryDto.skip,
      startTime: queryDto.startTime ? new Date(queryDto.startTime) : undefined,
      endTime: queryDto.endTime ? new Date(queryDto.endTime) : undefined,
      excludeInvalidated: true,
    });
    return new PaginatedResultDto<BlockchainEvent>(
      result.events,
      result.total,
      queryDto.page,
      queryDto.limit,
    );
  }

  @Get('realtime/temporal')
  @ApiOperation({
    summary: 'Query state at a specific block (temporal query)',
    description:
      'Returns events as they were at a given ledger sequence, supporting ' +
      'historical state reconstruction.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Temporal query results',
  })
  async getTemporalState(@Query() queryDto: TemporalQueryDto) {
    const result = await this.queryService.findEvents({
      ledgerFrom: 0,
      ledgerTo: queryDto.atLedger,
      eventType: queryDto.eventType,
      sourceAccount: queryDto.account,
      skip: queryDto.skip,
      limit: queryDto.limit,
      excludeInvalidated: true,
    });
    return {
      asOfLedger: queryDto.atLedger,
      ...new PaginatedResultDto<IndexedEvent>(
        result.events as any,
        result.total,
        queryDto.page,
        queryDto.limit,
      ),
    };
  }

  @Get('events/stream')
  @ApiOperation({ summary: 'Stream recent blockchain events via SSE' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Event stream',
  })
  async streamEvents(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(
      `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`,
    );

    const sendHeartbeat = () => {
      res.write(
        `data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`,
      );
    };

    const heartbeat = setInterval(sendHeartbeat, 30000);

    res.on('close', () => {
      clearInterval(heartbeat);
    });
  }

  // ─── Health and operational endpoints ───────────────────────────

  @Get('status')
  @ApiOperation({ summary: 'Get blockchain indexer status and metrics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Indexer status retrieved',
  })
  async getStatus() {
    return this.blockchainIndexerService.getStatus();
  }

  @Post('reorg-check')
  @ApiOperation({
    summary: 'Trigger blockchain reorganization detection and recovery',
  })
  @HttpCode(HttpStatus.OK)
  async triggerReorgCheck() {
    return this.blockchainIndexerService.getStatus();
  }
}
