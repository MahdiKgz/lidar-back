import { StorageModule } from '../storage/storage.module.js';
import { ProccessingModule } from '../proccessing/proccessing.module.js';
import { Module } from '@nestjs/common';
import { DatasetsService } from './datasets.service.js';
import { DatasetsController } from './datasets.controller.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from './entities/dataset.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset]),
    StorageModule,
    ProccessingModule,
  ],
  controllers: [DatasetsController],
  providers: [DatasetsService],
})
export class DatasetsModule {}
