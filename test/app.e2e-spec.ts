import { DatasetEventsService } from '../dist/datasets/dataset-events.service.js';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
// Exercise the compiled controllers so Nest receives production decorator metadata.
import { UploadsController } from '../dist/uploads/uploads.controller.js';
import { UploadService } from '../dist/uploads/uploads.service.js';
import { DatasetsController } from '../dist/datasets/datasets.controller.js';
import { DatasetsService } from '../dist/datasets/datasets.service.js';
import { setupSwagger } from '../dist/swagger.js';

describe('Upload HTTP contract and Swagger (mocked services)', () => {
  let app: INestApplication;
  const service = {
    initiateUpload: vi.fn().mockResolvedValue({ datasetId: 'dataset' }),
    generatePartUrls: vi.fn().mockResolvedValue({ parts: [] }),
  };
  const id = '3a2c0001-47d1-47bb-b4eb-439082f3424c';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadsController, DatasetsController],
      providers: [
        { provide: DatasetEventsService, useValue: {} },
        { provide: UploadService, useValue: service },
        {
          provide: DatasetsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    setupSwagger(app, 'api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a LAS/LAZ upload and documents the request and response', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/uploads/initiate')
      .send({ originalFilename: 'survey.laz', fileSize: 671811028 })
      .expect(201);
    expect(service.initiateUpload).toHaveBeenCalledWith(
      expect.objectContaining({ fileSize: 671811028 }),
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/openapi.json')
      .expect(200);
    expect(Object.keys(response.body.paths)).toHaveLength(12);
    expect(
      response.body.components.schemas.InitiateUploadDto.properties.fileSize
        .maximum,
    ).toBe(1073741824);
    expect(
      response.body.paths['/api/v1/uploads/initiate'].post.responses['201']
        .content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/InitiateUploadResponseDto');
    await request(app.getHttpServer()).get('/api/v1/docs/').expect(200);
  });

  it.each([
    { originalFilename: 'survey.txt', fileSize: 10 },
    { originalFilename: 'survey.laz', fileSize: 1073741825 },
    { originalFilename: 'survey.laz', fileSize: '10' },
    { originalFilename: 'survey.laz', fileSize: 10, extra: true },
  ])(
    'rejects invalid initiate data %j before invoking the service',
    async (body) => {
      await request(app.getHttpServer())
        .post('/api/v1/uploads/initiate')
        .send(body)
        .expect(400);
      expect(service.initiateUpload).not.toHaveBeenCalled();
    },
  );

  it.each([[0], [1, 1], [1.5], Array.from({ length: 101 }, (_, i) => i + 1)])(
    'rejects invalid part numbers %j',
    async (...numbers) => {
      await request(app.getHttpServer())
        .post(`/api/v1/uploads/${id}/parts/presign`)
        .send({ partNumbers: numbers })
        .expect(400);
      expect(service.generatePartUrls).not.toHaveBeenCalled();
    },
  );

  it('rejects unsafe dataset sorting and invalid pagination', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/datasets?sortBy=drop-table')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/datasets?limit=101')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/datasets/invalid')
      .expect(400);
  });

  it('rejects invalid session UUIDs', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/uploads/invalid/parts/presign')
      .send({ partNumbers: [1] })
      .expect(400);
    expect(service.generatePartUrls).not.toHaveBeenCalled();
  });
});
