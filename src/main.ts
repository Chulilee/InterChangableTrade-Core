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

  // CORS is enabled so the frontend can reach the API during development.
  app.enableCors();

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
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}/api`);
}

bootstrap();
