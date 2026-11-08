import { Module } from '@nestjs/common';
import { DatasetsService } from './datasets.service.js';
import { DatasetsController } from './datasets.controller.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from './entities/dataset.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset])],
  controllers: [DatasetsController],
  providers: [DatasetsService],
})
export class DatasetsModule {}
