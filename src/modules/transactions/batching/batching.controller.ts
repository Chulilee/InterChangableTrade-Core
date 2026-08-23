import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BatchingService } from './batching.service';
import { BatchStatus } from './entities/settlement-batch.entity';

@ApiTags('transactions')
@Controller('transactions')
export class BatchingController {
  constructor(private readonly batchingService: BatchingService) {}

  @Post('batch')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Manually trigger settlement of all currently pending transactions (bypasses time/size thresholds)',
  })
  triggerBatch() {
    return this.batchingService.triggerManual();
  }

  @Get('batches')
  @ApiOperation({ summary: 'Settlement batch history (audit trail)' })
  @ApiQuery({ name: 'status', required: false, enum: BatchStatus })
  history(@Query('status') status?: BatchStatus) {
    return this.batchingService.findHistory(status);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Batch details, net settlements and fee analysis' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.batchingService.findOne(id);
  }
}
