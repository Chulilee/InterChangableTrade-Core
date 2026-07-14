import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import {
  AllExceptionsFilter,
  TransformInterceptor,
} from '@app/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

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

  // Consistent success envelope and error shape across all endpoints.
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

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
