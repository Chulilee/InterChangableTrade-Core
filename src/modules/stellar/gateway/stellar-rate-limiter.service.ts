import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstLimit: number;
  enabled: boolean;
}

interface ClientRateLimit {
  requests: number;
  windowStart: number;
}

@Injectable()
export class StellarRateLimiterService {
  private readonly logger = new Logger(StellarRateLimiterService.name);
  private clientLimits: Map<string, ClientRateLimit> = new Map();
  private readonly config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      requestsPerMinute: this.configService.get<number>('stellar.rateLimitPerMinute') ?? 60,
      burstLimit: this.configService.get<number>('stellar.rateBurstLimit') ?? 10,
      enabled: this.configService.get<boolean>('stellar.rateLimitEnabled') ?? true,
    };

    this.logger.log(`Stellar rate limiter initialized: ${this.config.requestsPerMinute} req/min, burst: ${this.config.burstLimit}`);
    this.startCleanupInterval();
  }

  checkRateLimit(clientId: string): void {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    
    let clientLimit = this.clientLimits.get(clientId);
    
    if (!clientLimit || now - clientLimit.windowStart > windowMs) {
      clientLimit = {
        requests: 0,
        windowStart: now,
      };
    }

    if (clientLimit.requests >= this.config.requestsPerMinute) {
      this.logger.warn(`Rate limit exceeded for client ${clientId}`);
      throw new HttpException('Stellar API rate limit exceeded. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    clientLimit.requests++;
    this.clientLimits.set(clientId, clientLimit);
    
    this.logger.debug(`Client ${clientId} used ${clientLimit.requests}/${this.config.requestsPerMinute} requests`);
  }

  checkBurstLimit(concurrentRequests: number): void {
    if (!this.config.enabled) {
      return;
    }

    if (concurrentRequests >= this.config.burstLimit) {
      this.logger.warn(`Burst limit exceeded: ${concurrentRequests}/${this.config.burstLimit} concurrent requests`);
      throw new HttpException('Too many concurrent Stellar requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldWindows();
    }, 60000);
  }

  private cleanupOldWindows(): void {
    const now = Date.now();
    const windowMs = 60000;
    let cleanedCount = 0;

    for (const [clientId, limit] of this.clientLimits.entries()) {
      if (now - limit.windowStart > windowMs) {
        this.clientLimits.delete(clientId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired rate limit windows`);
    }
  }

  getRateLimitConfig(): RateLimitConfig {
    return { ...this.config };
  }

  getClientLimit(clientId: string): ClientRateLimit | undefined {
    return this.clientLimits.get(clientId);
  }

  onDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clientLimits.clear();
  }
}