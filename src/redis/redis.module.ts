import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Provides a shared ioredis client built from configuration. Exposed globally
 * so caching/indexing consumers can inject `@Inject(REDIS_CLIENT)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get('redis');
        return new Redis({
          host: redis.host,
          port: redis.port,
          password: redis.password || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
