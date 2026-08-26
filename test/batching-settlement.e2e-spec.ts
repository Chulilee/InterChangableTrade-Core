import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import {
  Transaction,
  TransactionStatus,
} from '../src/modules/transactions/entities/transaction.entity';
import { TransactionsModule } from '../src/modules/transactions/transactions.module';

/**
 * E2E validation of the settlement batching workflow (issue #27).
 * Requires DATABASE_URL; skipped in environments without one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const maybe = DATABASE_URL ? describe : describe.skip;

maybe('Settlement batching (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: DATABASE_URL,
          autoLoadEntities: true,
          synchronize: true,
        }),
        TransactionsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('settles pending transactions through a manual batch trigger', async () => {
    // Seed two opposing flows that should net into a single transfer.
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        fromAccount: 'GAA',
        toAccount: 'GBB',
        assetCode: 'XLM',
        amount: '10',
        status: TransactionStatus.PENDING,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .send({
        fromAccount: 'GBB',
        toAccount: 'GAA'.replace('AA', 'AA'),
        assetCode: 'XLM',
        amount: '4',
        status: TransactionStatus.PENDING,
      })
      .expect(201);

    const batch = await request(app.getHttpServer())
      .post('/transactions/batch')
      .expect(202);

    expect(batch.body.status).toBe('settled');
    expect(batch.body.settlements).toHaveLength(1);
    expect(Number(batch.body.feeAnalysis.savingsPercent)).toBeGreaterThan(20);
    // Latency budget from the acceptance criteria.
    expect(batch.body.processingMs).toBeLessThan(2000);

    const detail = await request(app.getHttpServer())
      .get(`/transactions/batches/${batch.body.id}`)
      .expect(200);
    expect(detail.body.id).toBe(batch.body.id);

    const history = await request(app.getHttpServer())
      .get('/transactions/batches')
      .expect(200);
    expect(Array.isArray(history.body)).toBe(true);
  });
});

// Silence unused-import lint when the suite is skipped.
void Transaction;
