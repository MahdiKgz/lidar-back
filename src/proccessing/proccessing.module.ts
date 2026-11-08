import { Module } from '@nestjs/common';
import { ProccessingService } from './proccessing.service.js';
import { BullModule } from '@nestjs/bullmq';
import { PROCESSING_QUEUE } from './processing.constant.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../datasets/entities/dataset.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProcessingProcessor } from './processing.processor.js';
import { PdalService } from './pdal.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset]),
    StorageModule,
    BullModule.registerQueue({
      name: PROCESSING_QUEUE,
    }),
  ],
  controllers: [],
  providers: [ProccessingService, PdalService, ProcessingProcessor],
  exports: [ProccessingService],
})
export class ProccessingModule {}
