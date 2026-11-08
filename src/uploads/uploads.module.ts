import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadSession } from './entities/upload-session.entity.js';
import { Dataset } from '../datasets/entities/dataset.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { UploadService } from './uploads.service.js';
import { ProccessingModule } from '../proccessing/proccessing.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UploadSession, Dataset]),
    StorageModule,
    ProccessingModule,
  ],
  controllers: [UploadsController],
  providers: [UploadService],
})
export class UploadsModule {}
