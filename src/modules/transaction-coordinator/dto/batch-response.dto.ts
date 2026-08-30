import { ApiProperty } from '@nestjs/swagger';
import { TransactionBatch } from '../entities/transaction-batch.entity';
import { BatchLeg } from '../entities/batch-leg.entity';

/**
 * Detailed response for a transaction batch including its legs and audit trail.
 */
export class BatchDetailResponse {
  @ApiProperty({ description: 'The transaction batch' })
  batch: TransactionBatch;

  @ApiProperty({
    description: 'The swap legs in this batch',
    type: [BatchLeg],
  })
  legs: BatchLeg[];

  @ApiProperty({
    description: 'Dependency graph of the legs',
  })
  dependencyGraph: Record<string, string[]>;

  @ApiProperty({
    description: 'Execution plan (groups of legs that can run in parallel)',
    type: [[String]],
  })
  executionPlan: string[][];

  @ApiProperty({
    description: 'Estimated total duration in milliseconds',
  })
  estimatedDurationMs: number;
}
