import { Test, TestingModule } from '@nestjs/testing';
import { WebhookSigningService } from './webhook-signing.service';

describe('WebhookSigningService', () => {
  let service: WebhookSigningService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookSigningService],
    }).compile();

    service = module.get<WebhookSigningService>(WebhookSigningService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateSecret', () => {
    it('should generate a 64-character hex string', () => {
      const secret = service.generateSecret();
      expect(secret).toBeDefined();
      expect(secret).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(secret)).toBe(true);
    });

    it('should generate unique secrets', () => {
      const secret1 = service.generateSecret();
      const secret2 = service.generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('signPayload', () => {
    it('should generate a valid HMAC-SHA256 signature', () => {
      const payload = { event: 'trade.completed', data: { id: '123' } };
      const secret = 'test-secret-key-12345678901234567890';

      const signature = service.signPayload(payload, secret);
      expect(signature).toBeDefined();
      expect(/^[0-9a-f]{64}$/.test(signature)).toBe(true);
    });

    it('should produce consistent signatures for the same input', () => {
      const payload = { event: 'trade.completed', data: { id: '123' } };
      const secret = 'test-secret-key-12345678901234567890';

      const sig1 = service.signPayload(payload, secret);
      const sig2 = service.signPayload(payload, secret);
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
      const secret = 'test-secret-key-12345678901234567890';
      const sig1 = service.signPayload({ event: 'trade.created' }, secret);
      const sig2 = service.signPayload({ event: 'trade.completed' }, secret);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const payload = { event: 'trade.completed' };
      const sig1 = service.signPayload(payload, 'secret-1');
      const sig2 = service.signPayload(payload, 'secret-2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const payload = { event: 'trade.completed', data: { id: '123' } };
      const secret = 'test-secret-key-12345678901234567890';

      const body = JSON.stringify(payload);
      const signature = service.signPayload(payload, secret);

      const isValid = service.verifySignature(body, signature, secret);
      expect(isValid).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const payload = { event: 'trade.completed' };
      const secret = 'test-secret-key-12345678901234567890';

      const body = JSON.stringify(payload);
      const isValid = service.verifySignature(
        body,
        'invalid-signature',
        secret,
      );
      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const payload = { event: 'trade.completed' };
      const body = JSON.stringify(payload);
      const signature = service.signPayload(payload, 'correct-secret');

      const isValid = service.verifySignature(body, signature, 'wrong-secret');
      expect(isValid).toBe(false);
    });

    it('should handle tampered payload', () => {
      const secret = 'test-secret-key-12345678901234567890';
      const originalPayload = { event: 'trade.completed', data: { id: '123' } };
      const signature = service.signPayload(originalPayload, secret);

      const tamperedPayload = { event: 'trade.completed', data: { id: '456' } };
      const tamperedBody = JSON.stringify(tamperedPayload);

      const isValid = service.verifySignature(tamperedBody, signature, secret);
      expect(isValid).toBe(false);
    });
  });

  describe('getSignatureHeaders', () => {
    it('should return headers with signature and timestamp', () => {
      const payload = { event: 'trade.completed' };
      const secret = 'test-secret-key-12345678901234567890';

      const headers = service.getSignatureHeaders(payload, secret);

      expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(headers['X-Webhook-Timestamp']).toBeDefined();
      expect(new Date(headers['X-Webhook-Timestamp']).getTime()).not.toBeNaN();
    });
  });
});
