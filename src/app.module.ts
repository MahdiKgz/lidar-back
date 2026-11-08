import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { UploadsModule } from './uploads/uploads.module.js';
import { DatasetsModule } from './datasets/datasets.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import appConfig from './config/app.config.js';
import { envValidationSchema } from './config/env.validation.js';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ProccessingModule } from './proccessing/proccessing.module.js';
import databaseConfig from './config/database.config.js';
import storageConfig from './config/storage.config.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST ?? '127.0.0.1',
          port: Number(process.env.REDIS_PORT ?? 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          db: Number(process.env.REDIS_DB ?? 0),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 3000,
        },
      }),
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: {
        // Allow unknown keys in the environment variables
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('database.host'),
        port: configService.getOrThrow<number>('database.port'),
        username: configService.getOrThrow<string>('database.username'),
        password: configService.getOrThrow<string>('database.password'),
        database: configService.getOrThrow<string>('database.database'),

        autoLoadEntities: true,
        synchronize: false,
        logging:
          configService.get<string>('app.nodeEnv') === 'development'
            ? ['error', 'warn']
            : false,
      }),
    }),
    UploadsModule,
    DatasetsModule,
    ProccessingModule,
  ],
})
export class AppModule {}
