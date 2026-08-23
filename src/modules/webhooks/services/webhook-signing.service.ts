import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Service for signing webhook payloads and verifying signatures.
 * Uses HMAC-SHA256 for payload signing.
 */
@Injectable()
export class WebhookSigningService {
  private readonly logger = new Logger(WebhookSigningService.name);

  /** Generate a cryptographically secure webhook secret */
  generateSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Sign a payload with the webhook secret using HMAC-SHA256.
   *
   * @param payload - The payload to sign (will be JSON stringified)
   * @param secret - The webhook signing secret
   * @returns The hex-encoded HMAC-SHA256 signature
   */
  signPayload(payload: Record<string, unknown>, secret: string): string {
    const body = JSON.stringify(payload);
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  /**
   * Verify a webhook signature against a payload.
   *
   * @param payload - The raw payload body received
   * @param signature - The signature from the X-Webhook-Signature header
   * @param secret - The webhook signing secret
   * @returns true if the signature is valid
   */
  verifySignature(
    payload: string | Buffer,
    signature: string,
    secret: string,
  ): boolean {
    try {
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      if (expectedSignature.length !== signature.length) {
        return false;
      }

      const a = Buffer.from(expectedSignature, 'hex');
      const b = Buffer.from(signature, 'hex');
      return timingSafeEqual(a, b);
    } catch (error) {
      this.logger.warn('Webhook signature verification failed', error);
      return false;
    }
  }

  /**
   * Build the signature header value for a delivery.
   * Returns an object with header name and value.
   */
  getSignatureHeaders(
    payload: Record<string, unknown>,
    secret: string,
  ): Record<string, string> {
    const signature = this.signPayload(payload, secret);
    return {
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Timestamp': new Date().toISOString(),
    };
  }
}
