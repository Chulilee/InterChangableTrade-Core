 import { Test, TestingModule } from '@nestjs/testing';
 import { INestApplication, ValidationPipe } from '@nestjs/common';
 import request from 'supertest';
 import { TypeOrmModule } from '@nestjs/typeorm';
 import { EventEmitterModule } from '@nestjs/event-emitter';
 import { getRepositoryToken } from '@nestjs/typeorm';
 import { RateLimitingModule } from '../src/modules/rate-limiting/rate-limiting.module';
 import { RateLimitConfig } from '../src/modules/rate-limiting/entities/rate-limit-config.entity';
 import { RateLimitGuard } from '../src/modules/rate-limiting/guards/rate-limit.guard';
 import { REDIS_CLIENT } from '../src/redis/redis.module';
 import Redis from 'ioredis';
 import { User } from '../src/modules/users/entities/user.entity';
 import { UserRole } from '../src/modules/users/entities/user.entity';
 
 /**
  * End-to-end tests for the Rate Limiting & Throttling module.
  *
  * These tests validate:
  *  - Basic rate limit enforcement (429 after limit exceeded)
  *  - X-RateLimit-* response headers
  *  - Multiple concurrent users tracked independently
  *  - Tier-based differentiation
  *  - Rate limit bypass for admin endpoints
  *  - Admin endpoint for runtime configuration
  *  - Retry-After header present on 429 responses
  *  - Authentication & authorization on admin endpoints (issue #78)
  *  - DTO validation (* pattern, maxRequests cap) (issue #78)
  *  - Key namespace isolation (issue #78)
  */
 describe('Rate Limiting (e2e)', () => {
   let app: INestApplication;
   let redisClient: Redis;
   let adminToken: string;
   let userToken: string;
   const TEST_PREFIX = `rl-e2e-${Date.now()}`;
 
   beforeAll(async () => {
     // Create a real Redis client for integration testing
     redisClient = new Redis({
       host: process.env.REDIS_HOST ?? 'localhost',
       port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
       password: process.env.REDIS_PASSWORD || undefined,
       lazyConnect: true,
       maxRetriesPerRequest: 3,
     });
 
     try {
       await redisClient.connect();
     } catch {
       console.warn('Redis not available, skipping e2e tests');
       return;
     }
 
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
           entities: [RateLimitConfig, User],
           synchronize: true,
           dropSchema: false,
         }),
         RateLimitingModule,
       ],
     })
       .overrideProvider(REDIS_CLIENT)
       .useValue(redisClient)
       .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
