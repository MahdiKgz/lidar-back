import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');

  app.setGlobalPrefix(apiPrefix);

  app.enableCors({
    origin: configService.get<string[]>('app.corsOrigins', [
      'http://localhost:5173',
    ]),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });

  app.enableShutdownHooks();

  const port = configService.get<number>('app.port', 3000);

  await app.listen(port, '0.0.0.0');
}
await bootstrap();
