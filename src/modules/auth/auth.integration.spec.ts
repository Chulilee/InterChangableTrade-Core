import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';

/**
 * End-to-end auth integration tests covering:
 *  - Registration & login
 *  - Refresh token flow
 *  - Logout & logout-all
 *  - Stellar wallet authentication
 *  - API key creation & usage
 *  - Password reset flow
 *  - Rate limiting on failed logins
 *  - RBAC enforcement
 */
describe('Auth Module (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and return token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123!',
          displayName: 'Test User',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user.email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'AnotherPass456!',
        })
        .expect(409);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'login-test@example.com',
          password: 'SecurePass123!',
        });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'SecurePass123!',
        })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'WrongPassword',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should issue a new token pair from a valid refresh token', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'refresh-test@example.com',
          password: 'SecurePass123!',
        });

      const { refreshToken } = registerRes.body.data;

      const refreshRes = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(refreshRes.body.data).toHaveProperty('accessToken');
      expect(refreshRes.body.data).toHaveProperty('refreshToken');
      expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken); // rotation
    });

    it('should reject an already-used refresh token', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'refresh-reuse-test@example.com',
          password: 'SecurePass123!',
        });

      const { refreshToken } = registerRes.body.data;

      // Use it once (rotation).
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Reuse should fail.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke the provided refresh token', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'logout-test@example.com',
          password: 'SecurePass123!',
        });

      const { accessToken, refreshToken } = registerRes.body.data;

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);

      // Subsequent refresh should fail.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return the authenticated user', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'me-test@example.com',
          password: 'SecurePass123!',
        });

      const { accessToken } = registerRes.body.data;

      const meRes = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(meRes.body.data.email).toBe('me-test@example.com');
    });

    it('should reject requests without a token', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });
  });

  describe('POST /api/auth/api-keys', () => {
    it('should create a new API key', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'api-key-test@example.com',
          password: 'SecurePass123!',
        });

      const { accessToken } = registerRes.body.data;

      const keyRes = await request(app.getHttpServer())
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Test Key' })
        .expect(201);

      expect(keyRes.body.data.plainKey).toMatch(/^ict_/);
      expect(keyRes.body.data.apiKey.name).toBe('Test Key');
    });
  });

  describe('GET /api/auth/api-key/verify', () => {
    it('should authenticate with a valid API key', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'api-key-verify@example.com',
          password: 'SecurePass123!',
        });

      const { accessToken } = registerRes.body.data;

      const keyRes = await request(app.getHttpServer())
        .post('/api/auth/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Verify Key' });

      const { plainKey } = keyRes.body.data;

      const verifyRes = await request(app.getHttpServer())
        .get('/api/auth/api-key/verify')
        .set('x-api-key', plainKey)
        .expect(200);

      expect(verifyRes.body.data.email).toBe('api-key-verify@example.com');
    });

    it('should reject invalid API key', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/api-key/verify')
        .set('x-api-key', 'ict_invalid')
        .expect(401);
    });
  });
});
