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
