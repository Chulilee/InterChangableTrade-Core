import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WebhookModule } from '../src/modules/webhooks/webhook.module';
import { WebhookSigningService } from '../src/modules/webhooks/services/webhook-signing.service';
import { WebhookDeliveryService } from '../src/modules/webhooks/services/webhook-delivery.service';
import { WebhookEvent } from '../src/modules/webhooks/enums/webhook-event.enum';

/**
 * E2E tests for the webhook system.
 *
 * Uses an in-memory SQLite database so no external services are required.
 * Mocks JWT auth via middleware injection.
 */
describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let signingService: WebhookSigningService;
  let deliveryService: WebhookDeliveryService;

  const mockUserId = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          autoLoadEntities: true,
          synchronize: true,
        }),
        EventEmitterModule.forRoot(),
        WebhookModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // Mock JWT auth
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: mockUserId, role: 'user' };
      next();
    });

    await app.init();

    signingService = moduleFixture.get(WebhookSigningService);
    deliveryService = moduleFixture.get(WebhookDeliveryService);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /api/webhooks', () => {
    it('should register a new webhook with a signing secret', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Trade Notifications',
          url: 'https://example.com/webhook',
          events: [
            WebhookEvent.TRADE_COMPLETED,
            WebhookEvent.SETTLEMENT_COMPLETED,
          ],
          description: 'Test webhook for trade events',
          maxRetries: 3,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe('Trade Notifications');
      expect(response.body.data.url).toBe('https://example.com/webhook');
      expect(response.body.data.events).toContain(WebhookEvent.TRADE_COMPLETED);
      expect(response.body.data.secret).toBeDefined();
      expect(response.body.data.secret).toHaveLength(64);
      expect(response.body.data.maxRetries).toBe(3);
    });

    it('should reject invalid URL', async () => {
      await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Bad Webhook',
          url: 'not-a-url',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(400);
    });
  });

  describe('GET /api/webhooks', () => {
    it('should return user webhooks', async () => {
      await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'List Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/webhooks')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.data).toBeInstanceOf(Array);
      expect(response.body.data.total).toBeGreaterThan(0);
    });
  });

  describe('PUT /api/webhooks/:id', () => {
    it('should update a webhook', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Update Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const webhookId = createRes.body.data.id;

      const response = await request(app.getHttpServer())
        .put(`/api/webhooks/${webhookId}`)
        .send({
          name: 'Updated Webhook',
          events: [WebhookEvent.TRADE_COMPLETED, WebhookEvent.BALANCE_CHANGED],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Webhook');
      expect(response.body.data.events).toContain(WebhookEvent.BALANCE_CHANGED);
    });
  });

  describe('POST /api/webhooks/:id/pause and resume', () => {
    it('should pause and resume a webhook', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Pause Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const webhookId = createRes.body.data.id;

      const pauseRes = await request(app.getHttpServer())
        .post(`/api/webhooks/${webhookId}/pause`)
        .expect(201);

      expect(pauseRes.body.data.status).toBe('paused');

      const resumeRes = await request(app.getHttpServer())
        .post(`/api/webhooks/${webhookId}/resume`)
        .expect(201);

      expect(resumeRes.body.data.status).toBe('active');
    });
  });

  describe('POST /api/webhooks/:id/test', () => {
    it('should send a test webhook delivery', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Test Delivery',
          url: 'https://httpbin.org/post',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const webhookId = createRes.body.data.id;

      const response = await request(app.getHttpServer())
        .post(`/api/webhooks/${webhookId}/test`)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.eventType).toBe('webhook.test');
    });
  });

  describe('POST /api/webhooks/verify-signature', () => {
    it('should verify a valid signature', async () => {
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'test-secret-key';
      const signature = signingService.signPayload(JSON.parse(payload), secret);

      const response = await request(app.getHttpServer())
        .post('/api/webhooks/verify-signature')
        .send({ payload, signature, secret })
        .expect(200);

      expect(response.body.data.valid).toBe(true);
    });

    it('should reject an invalid signature', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/webhooks/verify-signature')
        .send({
          payload: '{"event":"test"}',
          signature: 'invalid-signature',
          secret: 'test-secret',
        })
        .expect(200);

      expect(response.body.data.valid).toBe(false);
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('should delete a webhook', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Delete Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const webhookId = createRes.body.data.id;

      await request(app.getHttpServer())
        .delete(`/api/webhooks/${webhookId}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/webhooks/${webhookId}`)
        .expect(404);
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    it('should return delivery history', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Delivery History',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const webhookId = createRes.body.data.id;

      const response = await request(app.getHttpServer())
        .get(`/api/webhooks/${webhookId}/deliveries`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.data).toBeInstanceOf(Array);
    });
  });

  describe('Webhook event routing', () => {
    it('should route platform events to webhook deliveries', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Event Routing Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      await deliveryService.processEvent(WebhookEvent.TRADE_COMPLETED, {
        tradeId: 'trade-123',
        amount: '100.00',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app.getHttpServer())
        .get(`/api/webhooks/${createRes.body.data.id}/deliveries`)
        .expect(200);

      expect(response.body.data.data.length).toBeGreaterThan(0);
      expect(response.body.data.data[0].eventType).toBe(
        WebhookEvent.TRADE_COMPLETED,
      );
    });
  });

  describe('Performance', () => {
    it('should queue webhooks within 50ms', async () => {
      await request(app.getHttpServer())
        .post('/api/webhooks')
        .send({
          name: 'Performance Test',
          url: 'https://example.com/webhook',
          events: [WebhookEvent.TRADE_COMPLETED],
        })
        .expect(201);

      const startTime = Date.now();
      await deliveryService.processEvent(WebhookEvent.TRADE_COMPLETED, {
        tradeId: 'perf-test',
      } as any);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
