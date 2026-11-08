import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ValidationPipe } from '@nestjs/common';
import { setupSwagger } from './swagger.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');

  app.setGlobalPrefix(apiPrefix);

  app.enableCors({
    origin: configService.get<string[]>('app.corsOrigin', [
      'http://localhost:5173',
    ]),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  setupSwagger(app, apiPrefix);

  app.enableShutdownHooks();

  const port = configService.get<number>('app.port', 3000);

  await app.listen(port, '0.0.0.0');
}
await bootstrap();
