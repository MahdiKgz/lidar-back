import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim();
if (!process.env.LIDAR_ISOLATED_TEST) {
  const prefix = `lidar-test-${randomUUID().slice(0, 8)}`;
  const names = [];
  try {
    const specs = [
      [
        'pg',
        'postgres:16',
        '5432',
        [
          '-e',
          'POSTGRES_USER=lidar',
          '-e',
          'POSTGRES_PASSWORD=local-test-password',
          '-e',
          'POSTGRES_DB=lidar_test',
        ],
        [],
      ],
      ['redis', 'redis:7-alpine', '6379', [], []],
      [
        'minio',
        'minio/minio:RELEASE.2025-09-07T16-13-09Z',
        '9000',
        [
          '-e',
          'MINIO_ROOT_USER=lidartest',
          '-e',
          'MINIO_ROOT_PASSWORD=local-test-password',
          '-e',
          'MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:5173',
        ],
        ['server', '/data'],
      ],
    ];
    const ports = {};
    for (const [key, image, port, env, command] of specs) {
      const name = `${prefix}-${key}`;
      names.push(name);
      docker(
        'run',
        '-d',
        '--pull=never',
        '--name',
        name,
        '-p',
        `127.0.0.1::${port}`,
        ...env,
        image,
        ...command,
      );
      ports[key] = docker('port', name, port).split(':').pop();
    }
    const env = {
      ...process.env,
      LIDAR_ISOLATED_TEST: '1',
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: ports.pg,
      DB_USERNAME: 'lidar',
      DB_PASSWORD: 'local-test-password',
      DB_NAME: 'lidar_test',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: ports.redis,
      REDIS_DB: '0',
      REDIS_PASSWORD: '',
      MINIO_ENDPOINT: `http://127.0.0.1:${ports.minio}`,
      MINIO_PUBLIC_ENDPOINT: `http://127.0.0.1:${ports.minio}`,
      MINIO_ROOT_USER: 'lidartest',
      MINIO_ROOT_PASSWORD: 'local-test-password',
      MINIO_REGION: 'us-east-1',
      MINIO_BUCKET: 'lidar-test',
      MINIO_CONFIGURE_BUCKET: 'false',
      PROCESSING_WORKER_ENABLED:
        process.env.INTEGRATION_PROCESSING === '1' ? 'true' : 'false',
    };
    const result = spawnSync(process.execPath, [import.meta.filename], {
      env,
      stdio: 'inherit',
      timeout: 180000,
    });
    if (result.status !== 0) process.exitCode = 1;
  } finally {
    for (const name of names.reverse()) {
      try {
        docker('rm', '-f', '-v', name);
      } catch {}
    }
  }
} else {
  const { default: source } = await import('../dist/database/data-source.js');
  for (let i = 0; ; i++) {
    try {
      await source.initialize();
      break;
    } catch (error) {
      if (i > 30) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await source.runMigrations();
  await source.destroy();
  const { NestFactory } = await import('@nestjs/core');
  const { ValidationPipe } = await import('@nestjs/common');
  const { AppModule } = await import('../dist/app.module.js');
  const { StorageService } = await import('../dist/storage/storage.service.js');
  const { ApiExceptionFilter } =
    await import('../dist/common/api-exception.filter.js');
  const assert = (await import('node:assert/strict')).default;
  let app;
  if (process.env.INTEGRATION_PROCESSING === '1') {
    const { Test } = await import('@nestjs/testing');
    const { PdalService } = await import('../dist/proccessing/pdal.service.js');
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const inspection = {
      summary: { summary: { num_points: 5, srs: { wkt: 'EPSG:4326' } } },
      metadata: {},
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PdalService)
      .useValue({
        inspect: async () => inspection,
        convertToCopc: async (dir, _input, output) =>
          writeFile(join(dir, output), 'LASF-test-output'),
        verifyCopc: async () => inspection,
      })
      .compile();
    app = module.createNestApplication({ logger: ['error'] });
  } else app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  try {
    const base = `${await app.getUrl()}/api/v1`;
    const api = async (path, method = 'GET', body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(
        res.ok,
        `${method} ${path}: ${res.status} ${await res.clone().text()}`,
      );
      return res.status === 204 ? null : res.json();
    };
    const size = process.env.LARGE_UPLOAD === '1' ? 671811028 : 16777219;
    const upload = await api('/uploads/initiate', 'POST', {
      originalFilename: 'integration.laz',
      fileSize: size,
    });
    const numbers = Array.from({ length: upload.totalParts }, (_, i) => i + 1);
    const signed = await api(
      `/uploads/${upload.uploadSessionId}/parts/presign`,
      'POST',
      { partNumbers: numbers },
    );
    for (const part of signed.parts) {
      const length = Math.min(
        upload.partSize,
        size - (part.partNumber - 1) * upload.partSize,
      );
      const res = await fetch(part.url, {
        method: 'PUT',
        body: Buffer.alloc(length, 42),
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.ok(res.ok);
      assert.ok(res.headers.get('etag'));
    }
    const parts = await api(`/uploads/${upload.uploadSessionId}/parts`);
    assert.equal(parts.uploadedParts.length, upload.totalParts);
    assert.ok(parts.uploadedParts.every((p) => p.valid));
    await api(`/uploads/${upload.uploadSessionId}/complete`, 'POST');
    if (process.env.INTEGRATION_PROCESSING === '1')
      await new Promise((resolve) => setTimeout(resolve, 1500));
    await api(`/uploads/${upload.uploadSessionId}/complete`, 'POST');
    const download = await api(`/datasets/${upload.datasetId}/download`);
    const range = await fetch(download.url, {
      headers: { Range: 'bytes=0-3' },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 4);
    assert.equal(
      await app
        .get(StorageService)
        .getObjectSize(`datasets/${upload.datasetId}/original.laz`),
      size,
    );
    const list = await api('/datasets?page=1&limit=1&search=integration');
    assert.equal(list.total, 1);
    await api(`/datasets/${upload.datasetId}/status`);
    if (process.env.INTEGRATION_PROCESSING === '1') {
      for (let i = 0; ; i++) {
        const result = await api(`/datasets/${upload.datasetId}/status`);
        if (result.status === 'READY') break;
        if (i > 50 || result.status === 'FAILED')
          throw new Error('Worker did not reach READY.');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const copc = await api(`/datasets/${upload.datasetId}/copc`);
      const result = await fetch(copc.url, { headers: { Range: 'bytes=0-3' } });
      assert.equal(result.status, 206);
      assert.equal(await result.text(), 'LASF');
      console.log(
        'Real BullMQ worker → streamed MinIO files → metadata → READY → COPC Range passed (PDAL mocked, not installed).',
      );
    } else await api(`/datasets/${upload.datasetId}/requeue`, 'POST');
    await api(`/datasets/${upload.datasetId}`, 'DELETE');
    await api(`/datasets/${upload.datasetId}`, 'DELETE');
    assert.equal((await api('/datasets')).total, 0);
    console.log(
      `Infrastructure integration passed: migrations, ${size} byte multipart/resume/duplicate complete, queue, list/status/requeue, Range download, idempotent delete. PDAL execution disabled (mocked in worker mode).`,
    );
  } finally {
    await app.close();
  }
}
