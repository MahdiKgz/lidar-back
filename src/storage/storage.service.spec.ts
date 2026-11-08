import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StorageService } from './storage.service.js';

describe('StorageService streaming', () => {
  let dir: string;
  let service: StorageService;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lidar-storage-test-'));
    service = new StorageService(
      new ConfigService({
        storage: {
          endpoint: 'http://localhost:9000',
          publicEndpoint: 'http://localhost:9000',
          accessKey: 'test',
          secretKey: 'test',
          region: 'us-east-1',
          bucket: 'test',
        },
      }),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('pipes object chunks to disk and propagates stream errors', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({ Body: Readable.from(['las', 'data']) } as never);
    const path = join(dir, 'original.laz');
    await service.downloadToFile('original', path);
    expect((await readFile(path)).toString()).toBe('lasdata');
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    send.mockResolvedValueOnce({
      Body: Readable.from(
        (async function* () {
          yield 'partial';
          throw new Error('connection interrupted');
        })(),
      ),
    } as never);
    await expect(
      service.downloadToFile('original', join(dir, 'partial.laz')),
    ).rejects.toThrow('connection interrupted');
  });

  it('uploads a file stream with its exact content length', async () => {
    const path = join(dir, 'cloud.copc.laz');
    await writeFile(path, 'copc');
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    await service.uploadFromFile('processed', path);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.ContentLength).toBe(4);
    expect(command.input.Body).toBeInstanceOf(Readable);
    expect((command.input.Body as Readable).destroyed).toBe(true);
  });

  it('rejects a response without a readable stream', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await expect(
      service.downloadToFile('missing', join(dir, 'missing')),
    ).rejects.toThrow('readable');
  });
});
