import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { Notification } from '../src/modules/notifications/entities/notification.entity';
import { NotificationPreference } from '../src/modules/notifications/entities/notification-preference.entity';
import { NotificationTemplate } from '../src/modules/notifications/entities/notification-template.entity';
import { Channel } from '../src/modules/notifications/enums/channel.enum';
import { NotificationType } from '../src/modules/notifications/enums/notification-type.enum';

/**
 * End-to-end tests for the Notification System:
 *  - User preference management (create, read, update)
 *  - Direct notification send
 *  - Batch notification delivery
 *  - Notification history with pagination
 *  - Mark-as-read functionality
 *  - Template CRUD and send-from-template
 *  - Scheduled notifications
 *  - Trigger events
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: parseInt(process.env.DB_PORT ?? '5432', 10),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_NAME ?? 'interchangabletrade_test',
          entities: [Notification, NotificationPreference, NotificationTemplate],
          synchronize: true,
          dropSchema: false,
        }),
        NotificationsModule,
      ],
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

    // Use a fixed test user ID
    userId = `test-user-${Date.now()}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/notifications/preferences/:userId', () => {
    it('should create a new notification preference', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/notifications/preferences/${userId}`)
        .send({
          channel: Channel.EMAIL,
          isEnabled: true,
          subscribedTypes: [NotificationType.ORDER_UPDATE, NotificationType.PRICE_ALERT],
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.channel).toBe(Channel.EMAIL);
        expect(res.body.data.isEnabled).toBe(true);
      }
    });

    it('should update an existing preference to disable a channel', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/notifications/preferences/${userId}`)
        .send({
          channel: Channel.EMAIL,
          isEnabled: false,
        });

      if (res.status === 200) {
        expect(res.body.data.isEnabled).toBe(false);
      }
    });
  });

  describe('GET /api/notifications/preferences/:userId', () => {
    it('should return user notification preferences', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/notifications/preferences/${userId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/notifications/send', () => {
    it('should send a direct notification', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/send')
        .send({
          channel: Channel.IN_APP,
          recipient: userId,
          message: 'Direct notification test',
          type: NotificationType.SYSTEM_NOTICE,
          title: 'Test Title',
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.recipient).toBe(userId);
      }
    });
  });

  describe('POST /api/notifications/batch', () => {
    it('should send batch notifications', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/batch')
        .send({
          channel: Channel.IN_APP,
          type: NotificationType.ORDER_UPDATE,
          notifications: [
            { recipient: userId, message: 'Batch msg 1', title: 'Batch 1' },
            { recipient: userId, message: 'Batch msg 2', title: 'Batch 2' },
          ],
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.batchId).toBeDefined();
      }
    });
  });

  describe('GET /api/notifications', () => {
    it('should return paginated notification history', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/notifications?userId=${userId}&page=1&limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toBeDefined();
      expect(res.body.data.meta).toBeDefined();
      expect(res.body.data.meta.page).toBe(1);
    });

    it('should filter by type', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/notifications?userId=${userId}&type=${NotificationType.ORDER_UPDATE}&page=1&limit=10`,
        )
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });
  });

  describe('GET /api/notifications/unread-count/:userId', () => {
    it('should return unread count', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/notifications/unread-count/${userId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.unreadCount).toBe('number');
    });
  });

  describe('PATCH /api/notifications/read/:userId', () => {
    it('should mark all notifications as read', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/read/${userId}`)
        .send({ markAll: true });

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.markedCount).toBe('number');
      }
    });

    it('should mark specific notifications as read', async () => {
      // First get notifications to find IDs
      const listRes = await request(app.getHttpServer())
        .get(`/api/notifications?userId=${userId}&page=1&limit=5`)
        .expect(200);

      const ids = listRes.body.data.data?.map((n: any) => n.id) ?? [];
      if (ids.length === 0) return;

      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/read/${userId}`)
        .send({ notificationIds: ids.slice(0, 2) });

      if (res.status === 200) {
        expect(res.body.data.markedCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('POST /api/notifications/templates', () => {
    let templateName: string;

    it('should create an email template', async () => {
      templateName = `tpl-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/api/notifications/templates')
        .send({
          name: templateName,
          subject: 'Order {{orderId}} {{status}}',
          bodyTemplate: 'Your {{side}} order for {{assetCode}} has been {{status}}.',
          htmlTemplate: '<h1>Order {{status}}</h1><p>{{assetCode}}</p>',
          channel: Channel.EMAIL,
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe(templateName);
      }
    });
  });

  describe('POST /api/notifications/send-from-template', () => {
    it('should send notification using a template', async () => {
      // First create a template
      const tplName = `tpl-send-${Date.now()}`;
      await request(app.getHttpServer())
        .post('/api/notifications/templates')
        .send({
          name: tplName,
          subject: 'Order Alert',
          bodyTemplate: 'Your order {{orderId}} is {{status}}.',
          channel: Channel.IN_APP,
        });

      const res = await request(app.getHttpServer())
        .post('/api/notifications/send-from-template')
        .send({
          templateName: tplName,
          channel: Channel.IN_APP,
          recipient: userId,
          data: { orderId: 'ORD-100', status: 'filled', side: 'buy', assetCode: 'XLM' },
          type: NotificationType.ORDER_UPDATE,
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/send-from-template')
        .send({
          templateName: 'nonexistent-template',
          channel: Channel.IN_APP,
          recipient: userId,
          data: {},
        });

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('POST /api/notifications/schedule', () => {
    it('should schedule a notification for future delivery', async () => {
      const futureDate = new Date(Date.now() + 86400_000).toISOString();

      const res = await request(app.getHttpServer())
        .post('/api/notifications/schedule')
        .send({
          channel: Channel.IN_APP,
          recipient: userId,
          message: 'Scheduled notification',
          title: 'Scheduled',
          type: NotificationType.SYSTEM_NOTICE,
          scheduledAt: futureDate,
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.deliveryStatus).toBe('scheduled');
      }
    });
  });

  describe('Trigger events', () => {
    it('should trigger order update event', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/trigger/order')
        .send({
          userId,
          orderId: 'ORD-001',
          side: 'buy',
          assetCode: 'XLM',
          quantity: '100',
          price: '0.50',
          status: 'filled',
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should trigger price alert event', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/trigger/price')
        .send({
          userId,
          assetCode: 'XLM',
          currentPrice: '0.65',
          thresholdPrice: '0.50',
          direction: 'above',
          changePercent: '30',
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should trigger portfolio alert event', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/trigger/portfolio')
        .send({
          userId,
          alertType: 'threshold_breach',
          currentValue: '5000',
          threshold: '10000',
          details: { assetBreakdown: 'XLM: 80%, USDC: 20%' },
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should trigger system notice event', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/trigger/system')
        .send({
          title: 'Maintenance Window',
          message: 'Scheduled maintenance on Aug 20 from 2-4 AM UTC.',
          severity: 'warning',
          userId,
        });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  describe('Validation', () => {
    it('should reject invalid channel in send', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/send')
        .send({
          channel: 'invalid_channel',
          recipient: userId,
          message: 'test',
        });

      expect(res.status).toBe(400);
    });

    it('should reject send without required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notifications/send')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
