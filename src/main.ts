import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter, TransformInterceptor } from '@app/common';
import { AppModule } from './app.module';
import { ErrorHandlerService } from './modules/error-handler/error-handler.service';
import { RateLimitGuard } from './modules/rate-limiting/guards/rate-limit.guard';
import { RATE_LIMIT_HEADERS } from './modules/rate-limiting/enums/rate-limit.enum';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // Trust exactly the configured number of reverse-proxy hops. Expected
  // topology: client → TLS-terminating load balancer / ingress → this app
  // (`TRUST_PROXY_HOPS=1`). Express then derives `req.ip` from the
  // X-Forwarded-For entry appended by that trusted hop; application code must
  // never parse the header itself, because a client can prepend arbitrary
  // values to it. Deployments with no proxy set `TRUST_PROXY_HOPS=0` so the
  // header is ignored entirely. See docs/rate-limiting.md.
  const trustProxySetting =
    configService.get<string>('http.trustProxyHops') ?? '1';
  app.set(
    'trust proxy',
    /^\d+$/.test(trustProxySetting)
      ? parseInt(trustProxySetting, 10)
      : trustProxySetting,
  );

  // Security headers.
  app.use(helmet());

  // Global API prefix keeps versioning and routing predictable.
  app.setGlobalPrefix('api');

  // Reject unknown properties and coerce DTO types across every route.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global rate limiting guard — protects all routes except those
  // decorated with @BypassRateLimit().
  const rateLimitGuard = app.get(RateLimitGuard);
  app.useGlobalGuards(rateLimitGuard);

  // Consistent success envelope and error shape across all endpoints.
  app.useGlobalInterceptors(new TransformInterceptor());
  const errorHandler = app.get(ErrorHandlerService);
  app.useGlobalFilters(new AllExceptionsFilter(errorHandler));

  // CORS is restricted to the configured origin allowlist
  // (CORS_ALLOWED_ORIGINS). In production the env schema refuses to boot
  // when the variable is unset or contains a wildcard, and in development an
  // unset value falls back to the localhost dev origins, so the documented
  // frontend workflow keeps working.
  app.enableCors({
    origin: configService.get<string[]>('cors.allowedOrigins'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'X-Request-Id',
    ],
    maxAge: 600,
  });

  // OpenAPI docs served at /api/docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('InterChangableTrade Core API')
    .setDescription(
      'Application services connecting the frontend with the Stellar blockchain.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Document the headers emitted by the global guard on successful and 429 responses.
  // The actual quota and window are configuration-dependent, so no static tier
  // values are promised in OpenAPI.
  const quotaHeaders = {
    [RATE_LIMIT_HEADERS.LIMIT]: {
      description: 'Maximum requests in the configured rate-limit window.',
      schema: { type: 'integer' },
    },
    [RATE_LIMIT_HEADERS.REMAINING]: {
      description: 'Requests remaining in the current window.',
      schema: { type: 'integer' },
    },
    [RATE_LIMIT_HEADERS.RESET]: {
      description:
        'Unix timestamp (seconds) when the next request slot resets.',
      schema: { type: 'integer' },
    },
    [RATE_LIMIT_HEADERS.POLICY]: {
      description: 'Configured request limit and window, e.g. 100;w=60.',
      schema: { type: 'string' },
    },
  };
  for (const pathItem of Object.values(document.paths)) {
    for (const method of [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
    ] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      for (const response of Object.values(operation.responses)) {
        if (!response || '$ref' in response) continue;
        response.headers = { ...response.headers, ...quotaHeaders };
      }
      const retryHeader = {
        [RATE_LIMIT_HEADERS.RETRY_AFTER]: {
          description:
            'Seconds until the oldest request in the window expires.',
          schema: { type: 'integer' },
        },
      };
      const tooManyRequests = operation.responses['429'];
      if (tooManyRequests && !('$ref' in tooManyRequests)) {
        tooManyRequests.headers = {
          ...tooManyRequests.headers,
          ...retryHeader,
        };
      } else if (!tooManyRequests) {
        operation.responses['429'] = {
          description:
            'Rate limit exceeded; wait Retry-After seconds before retrying.',
          headers: { ...quotaHeaders, ...retryHeader },
        };
      }
    }
  }
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}/api`);
}

bootstrap();
