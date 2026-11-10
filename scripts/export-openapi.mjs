import { DatasetEventsService } from '../dist/datasets/dataset-events.service.js';
import 'reflect-metadata';
import { writeFile, mkdir } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { UploadsController } from '../dist/uploads/uploads.controller.js';
import { UploadService } from '../dist/uploads/uploads.service.js';
import { DatasetsController } from '../dist/datasets/datasets.controller.js';
import { DatasetsService } from '../dist/datasets/datasets.service.js';
import { createApiDocument } from '../dist/swagger.js';

// Generate the HTTP contract without database, Redis, MinIO or PDAL connections.
class DocumentationModule {}
Module({
  controllers: [UploadsController, DatasetsController],
  providers: [
    { provide: DatasetEventsService, useValue: {} },
    { provide: UploadService, useValue: {} },
    { provide: DatasetsService, useValue: {} },
  ],
})(DocumentationModule);
const app = await NestFactory.create(DocumentationModule, { logger: false });
try {
  app.setGlobalPrefix('api/v1');
  const document = createApiDocument(app);
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../docs/openapi.json', import.meta.url),
    JSON.stringify(document, null, 2) + '\n',
  );
  console.log('Generated docs/openapi.json');
} finally {
  await app.close();
}
