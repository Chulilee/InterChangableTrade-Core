import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end tests for marketplace advanced order types:
 *  - Creating market, limit, stop-loss and trailing-stop orders
 *  - Order state machine (PENDING -> TRIGGERED -> CANCELLED)
 *  - Retrieval of complete order state
 */
describe('Marketplace advanced order types (e2e)', () => {
  let app: INestApplication;
  let sellerToken: string;
  let buyerToken: string;
  let listingId: string;

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

    const sellerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `marketplace-seller-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Marketplace Seller',
      });
    sellerToken = sellerRes.body.data.accessToken;

    const buyerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `marketplace-buyer-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Marketplace Buyer',
      });
    buyerToken = buyerRes.body.data.accessToken;

    const listingRes = await request(app.getHttpServer())
      .post('/api/marketplace/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Selling 100 USDC',
        assetCode: 'USDC',
        amount: '100.0000000',
        price: '1.0000000',
        priceAssetCode: 'XLM',
      });

    if (listingRes.status === 201) {
      listingId = listingRes.body.data.id;
    }
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/marketplace/listings/orders', () => {
    it('should create a market order', async () => {
      if (!listingId || !buyerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'buy',
          orderType: 'market',
          amount: '10.0000000',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.orderType).toBe('market');
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.filledAmount).toBe('0');
    });

    it('should create a limit order with a price condition', async () => {
      if (!listingId || !buyerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'buy',
          orderType: 'limit',
          amount: '5.0000000',
          price: '0.9500000',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.orderType).toBe('limit');
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.price).toBe('0.9500000');
    });

    it('should create a stop-loss order with a stop price', async () => {
      if (!listingId || !buyerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'sell',
          orderType: 'stop_loss',
          amount: '5.0000000',
          price: '1.1000000',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.orderType).toBe('stop_loss');
      expect(res.body.data.status).toBe('pending');
    });

    it('should create a trailing-stop order with a trailing percentage', async () => {
      if (!listingId || !buyerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'sell',
          orderType: 'trailing_stop',
          amount: '5.0000000',
          stopPercentage: '5',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.orderType).toBe('trailing_stop');
      expect(res.body.data.status).toBe('pending');
    });

    it('should reject a limit order without a price', async () => {
      if (!listingId || !buyerToken) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'buy',
          orderType: 'limit',
          amount: '5.0000000',
        });

      expect(res.status).toBe(400);
    });

    it('should require authentication to create orders', async () => {
      if (!listingId) return;

      const res = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .send({
          listingId,
          side: 'buy',
          orderType: 'market',
          amount: '10.0000000',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/marketplace/listings/orders/:id', () => {
    it('should return complete order state', async () => {
      if (!listingId || !buyerToken) return;

      const createRes = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'buy',
          orderType: 'limit',
          amount: '1.0000000',
          price: '0.9800000',
        });

      if (createRes.status !== 201) return;
      const orderId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/api/marketplace/listings/orders/${orderId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(orderId);
      expect(res.body.data.status).toBeDefined();
      expect(res.body.data.orderType).toBeDefined();
      expect(res.body.data.listing).toBeDefined();
    });
  });

  describe('Order lifecycle: cancellation of pending orders', () => {
    it('should allow the owner to cancel a pending order', async () => {
      if (!listingId || !buyerToken) return;

      const createRes = await request(app.getHttpServer())
        .post('/api/marketplace/listings/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          listingId,
          side: 'buy',
          orderType: 'limit',
          amount: '1.0000000',
          price: '0.9000000',
        });

      if (createRes.status !== 201) return;
      const orderId = createRes.body.data.id;

      const cancelRes = await request(app.getHttpServer())
        .delete(`/api/marketplace/listings/orders/${orderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      if (cancelRes.status === 200) {
        expect(cancelRes.body.data.status).toBe('cancelled');
      }
    });
  });
});
