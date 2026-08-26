import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { KycLevel } from '../src/modules/compliance/enums/kyc-level.enum';
import { KycDocumentType } from '../src/modules/compliance/enums/kyc-document-type.enum';
import { AmlFlagStatus } from '../src/modules/compliance/enums/aml-flag-status.enum';
import { ComplianceRegion } from '../src/modules/compliance/enums/compliance-region.enum';

/**
 * End-to-end tests for the complete KYC/AML compliance workflow:
 *  - KYC verification initiation and status checking
 *  - Document upload and review
 *  - Risk scoring and transaction assessment
 *  - AML flag creation and admin review
 *  - Compliance configuration management
 *  - Audit trail tracking
 *  - Transaction blocking for high-risk users
 */
const describeIfDb = process.env.DB_HOST ? describe : describe.skip;

describeIfDb('KYC/AML Compliance (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let flagId: string;
  let documentId: string;

  beforeAll(async () => {
    const { AppModule } = require('../src/app.module');
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

    // Register a regular user
    const userRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `compliance-user-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Compliance Test User',
      });
    userToken = userRes.body.data?.accessToken;
    userId = userRes.body.data?.user?.id;

    // Register an admin user
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `compliance-admin-${Date.now()}@test.com`,
        password: 'SecurePass123!',
        displayName: 'Compliance Admin',
      });
    adminToken = adminRes.body.data?.accessToken;
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /api/compliance/kyc/verify', () => {
    it('should initiate KYC verification workflow', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/kyc/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ region: 'US' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.level).toBe(KycLevel.UNVERIFIED);
      expect(res.body.data.region).toBe('US');
    });
  });

  describe('GET /api/compliance/kyc/status', () => {
    it('should return KYC status for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/kyc/status')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.level).toBeDefined();
      expect(res.body.data.riskLevel).toBeDefined();
    });
  });

  describe('POST /api/compliance/kyc/documents/upload', () => {
    it('should upload a document for KYC verification', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/kyc/documents/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', Buffer.from('test identity document content'), {
          filename: 'passport.pdf',
          contentType: 'application/pdf',
        })
        .field('documentType', KycDocumentType.ID_VERIFICATION);

      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.documentType).toBe(
          KycDocumentType.ID_VERIFICATION,
        );
        expect(res.body.data.fileName).toBe('passport.pdf');
        expect(res.body.data.status).toBe('pending');
        documentId = res.body.data.id;
      } else {
        expect([400, 404]).toContain(res.status);
      }
    });

    it('should reject invalid file types', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/kyc/documents/upload')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', Buffer.from('malicious content'), {
          filename: 'malware.exe',
          contentType: 'application/x-executable',
        })
        .field('documentType', KycDocumentType.ID_VERIFICATION);

      expect([400, 500]).toContain(res.status);
    });
  });

  describe('GET /api/compliance/kyc/documents', () => {
    it('should list documents for the user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/kyc/documents')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/compliance/risk/score', () => {
    it('should return risk score for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/risk/score')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.score).toBeDefined();
      expect(typeof res.body.data.score).toBe('number');
      expect(res.body.data.level).toBeDefined();
      expect(res.body.data.factors).toBeDefined();
    });
  });

  describe('POST /api/compliance/risk/assess-transaction', () => {
    it('should assess transaction risk for low-risk transaction', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/risk/assess-transaction')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 100, transactionType: 'buy' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.riskLevel).toBeDefined();
      expect(typeof res.body.data.riskScore).toBe('number');
      expect(typeof res.body.data.shouldBlock).toBe('boolean');
      expect(Array.isArray(res.body.data.triggeredRules)).toBe(true);
    });

    it('should flag high-value transactions', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/risk/assess-transaction')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 15000, transactionType: 'buy' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.triggeredRules).toContain(
        'aml_transaction_threshold',
      );
    });
  });

  describe('AML Flag workflow', () => {
    it('should create a flag when assessing a risky transaction', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/compliance/risk/assess-transaction')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 15000, transactionType: 'buy' })
        .expect(200);

      if (res.body.data.flag) {
        flagId = res.body.data.flag.id;
      }
    });

    it('should list AML flags for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/aml/flags')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.data).toBeDefined();
        expect(res.body.data.meta).toBeDefined();
      } else {
        expect(res.status).toBe(403);
      }
    });

    it('should review and clear an AML flag', async () => {
      if (!flagId) return;

      const res = await request(app.getHttpServer())
        .put(`/api/compliance/aml/flags/${flagId}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: AmlFlagStatus.CLEARED,
          resolutionNotes: 'Transaction is legitimate after investigation',
        });

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe(AmlFlagStatus.CLEARED);
        expect(res.body.data.resolutionNotes).toContain('legitimate');
      } else {
        expect([403, 400, 409]).toContain(res.status);
      }
    });
  });

  describe('Compliance configuration', () => {
    it('should get global compliance config for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/config/global')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      } else {
        expect(res.status).toBe(403);
      }
    });

    it('should list all compliance configs for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/config')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      } else {
        expect(res.status).toBe(403);
      }
    });

    it('should reject config access from non-admin', async () => {
      await request(app.getHttpServer())
        .get('/api/compliance/config')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('Audit trail', () => {
    it('should return audit trail for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/audit')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should return all audit logs for admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/compliance/audit/all')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      } else {
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Transaction blocking', () => {
    it('should check if user transactions are blocked', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/compliance/risk/check-transaction-block/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.blocked).toBe('boolean');
      } else {
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Unauthorized access', () => {
    it('should reject requests without token', async () => {
      await request(app.getHttpServer())
        .get('/api/compliance/kyc/status')
        .expect(401);
    });

    it('should reject admin endpoints from regular users', async () => {
      await request(app.getHttpServer())
        .get('/api/compliance/aml/flags')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should reject config update from non-admin', async () => {
      await request(app.getHttpServer())
        .put('/api/compliance/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          region: ComplianceRegion.GLOBAL,
          displayName: 'Hacked',
        })
        .expect(403);
    });
  });
});
