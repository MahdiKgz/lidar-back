import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.argv[2] || process.argv.includes('--help')) {
  console.log(
    'Usage: SMOKE_API_URL=http://localhost:3000/api/v1 node scripts/smoke.mjs /absolute/file.las',
  );
  console.log(
    'Optional: SMOKE_ORIGIN=http://localhost:5173 SMOKE_TIMEOUT_MS=3600000 SMOKE_DELETE=1',
  );
  process.exit(0);
}
const file = process.argv[2];
const size = (await stat(file)).size;
if (!/\.(las|laz)$/i.test(file) || size < 1 || size > 1073741824)
  throw new Error('Expected LAS/LAZ file, 1 byte to 1 GiB.');
const base = (
  process.env.SMOKE_API_URL || 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const origin = process.env.SMOKE_ORIGIN;
const api = async (path, method = 'GET', body) => {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`API ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const upload = await api('/uploads/initiate', 'POST', {
  originalFilename: basename(file),
  fileSize: size,
});
console.log(
  `Dataset ${upload.datasetId}; ${size} bytes; ${upload.totalParts} parts`,
);
for (let number = 1; number <= upload.totalParts; number++) {
  for (let attempt = 0; ; attempt++) {
    try {
      const signed = await api(
        `/uploads/${upload.uploadSessionId}/parts/presign`,
        'POST',
        { partNumbers: [number] },
      );
      const start = (number - 1) * upload.partSize,
        end = Math.min(size, number * upload.partSize) - 1;
      const response = await fetch(signed.parts[0].url, {
        method: 'PUT',
        body: createReadStream(file, { start, end }),
        duplex: 'half',
        headers: {
          'Content-Length': String(end - start + 1),
          ...(origin ? { Origin: origin } : {}),
        },
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`PUT HTTP ${response.status}`);
      if (
        origin &&
        !['*', origin].includes(
          response.headers.get('access-control-allow-origin'),
        )
      )
        throw new Error('Storage CORS origin missing or invalid.');
      break;
    } catch (error) {
      if (attempt >= 2) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
  console.log(
    `Upload ${Math.round((Math.min(size, number * upload.partSize) / size) * 100)}%`,
  );
}
const parts = await api(`/uploads/${upload.uploadSessionId}/parts`);
if (
  parts.uploadedParts.length !== upload.totalParts ||
  parts.uploadedParts.some((part) => !part.valid)
)
  throw new Error('Multipart verification failed.');
await api(`/uploads/${upload.uploadSessionId}/complete`, 'POST');
await api(`/uploads/${upload.uploadSessionId}/complete`, 'POST');
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS || 3600000);
let previous = '';
while (true) {
  const status = await api(`/datasets/${upload.datasetId}/status`);
  if (status.status !== previous) {
    console.log(`Processing ${status.status}`);
    previous = status.status;
  }
  if (status.status === 'FAILED')
    throw new Error(status.processingError || 'Processing failed.');
  if (status.status === 'READY') break;
  if (Date.now() >= deadline)
    throw new Error('Processing timed out; dataset retained for inspection.');
  await delay(3000);
}
const dataset = await api(`/datasets/${upload.datasetId}`);
if (!dataset.metadata?.lidar?.processed?.objectKey)
  throw new Error('Missing committed COPC metadata.');
for (const type of ['download', 'copc']) {
  const signed = await api(`/datasets/${upload.datasetId}/${type}`);
  const response = await fetch(signed.url, {
    headers: { Range: 'bytes=0-3', ...(origin ? { Origin: origin } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(`${type}: expected Range HTTP 206`);
  }
  if (
    origin &&
    !['*', origin].includes(response.headers.get('access-control-allow-origin'))
  )
    throw new Error(`${type}: CORS origin invalid.`);
  if (new TextDecoder().decode(await response.arrayBuffer()) !== 'LASF')
    throw new Error(`${type}: invalid LAS signature.`);
}
if (process.env.SMOKE_DELETE === '1') {
  await api(`/datasets/${upload.datasetId}`, 'DELETE');
  await api(`/datasets/${upload.datasetId}`, 'DELETE');
}
console.log(
  `PASS: real file → multipart → queue → PDAL → READY → original/COPC Range. Dataset ${upload.datasetId}`,
);
console.log(
  'Next: open frontend and select this dataset to verify WebGL point rendering and zoom/LOD.',
);
