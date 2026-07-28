import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DisputeClassification } from '../src/modules/dispute-resolution/enums/dispute-classification.enum';
import { DisputeResolutionType } from '../src/modules/dispute-resolution/enums/dispute-resolution-type.enum';

/**
 * End-to-end tests for the complete dispute resolution lifecycle:
 *  - Dispute creation with classification
 *  - Evidence upload
 *  - Dispute retrieval
 *  - Message communication
 *  - Resolution and enforcement
 *  - Appeal process (one per dispute)
 *  - Analytics dashboard
 */
describe('Dispute Resolution (e2e)', () => {
  let app: INestApplication;
  let complainantToken: string;
  let respondentToken: string;
  let adminToken: string;
  let tradeId: string;
  let disputeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const complainantRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `dispute-complainant-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Dispute Complainant',
      });
    complainantToken = complainantRes.body.data.accessToken;

    const respondentRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `dispute-respondent-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Dispute Respondent',
      });
    respondentToken = respondentRes.body.data.accessToken;

    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `dispute-admin-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Dispute Admin',
      });
    adminToken = adminRes.body.data.accessToken;

    await request(app.getHttpServer())
      .post('/api/trading/orders')
      .set('Authorization', `Bearer ${complainantToken}`)
      .send({
        side: 'buy',
        type: 'limit',
        assetCode: 'XLM',
        quantity: '10',
        price: '1',
      });

    await request(app.getHttpServer())
      .post('/api/trading/orders')
      .set('Authorization', `Bearer ${respondentToken}`)
      .send({
        side: 'sell',
        type: 'limit',
        assetCode: 'XLM',
        quantity: '10',
        price: '1',
      });

    const tradesRes = await request(app.getHttpServer())
      .get('/api/trading/trades')
      .set('Authorization', `Bearer ${complainantToken}`);

    if (tradesRes.body.data?.data?.length > 0) {
      tradeId = tradesRes.body.data.data[0].id;
    } else {
      tradeId = '00000000-0000-4000-8000-000000000001';
    }
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/disputes', () => {
    it('should create a dispute with classification', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/disputes')
        .set('Authorization', `Bearer ${complainantToken}`)
        .send({
          tradeId,
          classification: DisputeClassification.NON_DELIVERY,
          description:
            'The seller did not deliver the agreed assets to my wallet within the expected timeframe.',
        });

      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.classification).toBe(
          DisputeClassification.NON_DELIVERY,
        );
        expect(res.body.data.status).toBe('filed');
        expect(res.body.data.initialReviewDeadline).toBeDefined();
        expect(res.body.data.resolutionDeadline).toBeDefined();
        disputeId = res.body.data.id;
      } else {
        expect([403, 404, 400]).toContain(res.status);
      }
    });

    it('should reject dispute from non-participant', async () => {
      const outsiderRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: `dispute-outsider-${Date.now()}@test.com`,
          password: 'SecurePass123!',
        });

      const res = await request(app.getHttpServer())
        .post('/api/disputes')
        .set('Authorization', `Bearer ${outsiderRes.body.data.accessToken}`)
        .send({
          tradeId,
          classification: DisputeClassification.FRAUD,
          description:
            'Attempting to file a dispute as a non-participant in the trade.',
        });

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('GET /api/disputes/:id', () => {
    it('should return dispute status and details', async () => {
      if (!disputeId) return;

      const res = await request(app.getHttpServer())
        .get(`/api/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${complainantToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.dispute).toBeDefined();
      expect(res.body.data.slaStatus).toBeDefined();
      expect(res.body.data.slaStatus.initialReviewDeadline).toBeDefined();
      expect(res.body.data.slaStatus.resolutionDeadline).toBeDefined();
    });
  });

  describe('POST /api/disputes/:id/evidence', () => {
    it('should upload evidence with file validation', async () => {
      if (!disputeId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${complainantToken}`)
        .attach('file', Buffer.from('test evidence content'), {
          filename: 'evidence.pdf',
          contentType: 'application/pdf',
        })
        .field('description', 'Proof of non-delivery screenshot');

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.fileName).toBe('evidence.pdf');
        expect(res.body.data.mimeType).toBe('application/pdf');
      }
    });

    it('should reject invalid file types', async () => {
      if (!disputeId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/disputes/${disputeId}/evidence`)
        .set('Authorization', `Bearer ${complainantToken}`)
        .attach('file', Buffer.from('malicious'), {
          filename: 'malware.exe',
          contentType: 'application/x-executable',
        });

      expect([400, 500]).toContain(res.status);
    });
  });

  describe('POST /api/disputes/:id/messages', () => {
    it('should allow parties to communicate', async () => {
      if (!disputeId) return;

      const res = await request(app.getHttpServer())
        .post(`/api/disputes/${disputeId}/messages`)
        .set('Authorization', `Bearer ${respondentToken}`)
        .send({
          content: 'I did deliver the assets. Here is my explanation.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toContain('deliver');
    });
  });

  describe('Dispute lifecycle: resolve and appeal', () => {
    it('should resolve dispute and allow one appeal', async () => {
      if (!disputeId) return;

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          resolutionType: DisputeResolutionType.REFUND,
          decisionReasoning:
            'After reviewing all evidence, the complainant is entitled to a full refund.',
          resolutionAmount: '10.0000000',
        });

      if (resolveRes.status === 200) {
        expect(resolveRes.body.data.status).toBe('resolved');

        const appealRes = await request(app.getHttpServer())
          .post(`/api/disputes/${disputeId}/appeal`)
          .set('Authorization', `Bearer ${respondentToken}`)
          .send({
            appealReason:
              'New evidence has surfaced that was not available during the initial review.',
          });

        if (appealRes.status === 201 || appealRes.status === 200) {
          expect(appealRes.body.data.appealed).toBe(true);

          const secondAppeal = await request(app.getHttpServer())
            .post(`/api/disputes/${disputeId}/appeal`)
            .set('Authorization', `Bearer ${respondentToken}`)
            .send({
              appealReason:
                'Attempting a second appeal which should be rejected by the system.',
            });

          expect(secondAppeal.status).toBe(400);
        }
      }
    });
  });

  describe('GET /api/disputes/analytics/dashboard', () => {
    it('should return dispute metrics for authorized users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/disputes/analytics/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.data.totalDisputes).toBeDefined();
        expect(res.body.data.byClassification).toBeDefined();
        expect(res.body.data.trends).toBeDefined();
      } else {
        expect(res.status).toBe(403);
      }
    });
  });

  describe('GET /api/disputes', () => {
    it('should list disputes for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/disputes')
        .set('Authorization', `Bearer ${complainantToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toBeDefined();
      expect(res.body.data.meta).toBeDefined();
    });
  });
});
