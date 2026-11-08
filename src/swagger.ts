import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('LiDAR Backend API')
    .setVersion('1.0')
    .setDescription(
      'Upload LAS/LAZ files directly to MinIO using multipart presigned URLs. ' +
        '1. Initiate. 2. Presign parts. 3. PUT each binary part to its URL. ' +
        '4. List parts to resume. 5. Complete to enqueue COPC processing. ' +
        'Parts are 16 MiB except the last; maximum file size is 1 GiB. ' +
        'MinIO must allow the browser origin and PUT, and expose ETag. ' +
        'Part URLs expire after 900 seconds; upload sessions after 24 hours. ' +
        'Do not send API JSON headers with binary PUT requests. ' +
        'Use Dataset APIs for metadata, status/progress, short-lived original/COPC download URLs and deletion. ' +
        'POST /datasets/{id}/requeue retries failed processing. Complete returns processingEnqueuePending when Redis is unavailable; reconciliation recovers automatically. ' +
        'Errors contain statusCode, error, message, timestamp and path.',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication, apiPrefix: string): void {
  SwaggerModule.setup(`${apiPrefix}/docs`, app, () => createApiDocument(app), {
    jsonDocumentUrl: `${apiPrefix}/openapi.json`,
    swaggerOptions: { persistAuthorization: false },
  });
}
