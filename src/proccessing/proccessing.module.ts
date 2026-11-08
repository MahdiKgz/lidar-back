import { Module } from '@nestjs/common';
import { ProccessingService } from './proccessing.service.js';
import { BullModule } from '@nestjs/bullmq';
import { PROCESSING_QUEUE } from './processing.constant.js';
import { PdalService } from './pdal.service.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: async () => ({
        connection: {
          host: process.env.REDIS_HOST ?? '127.0.0.1',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      }),
    }),

    BullModule.registerQueue({
      name: PROCESSING_QUEUE,
    }),
  ],
  controllers: [],
  providers: [ProccessingService, PdalService],
})
export class ProccessingModule {}
