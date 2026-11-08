import 'reflect-metadata';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import type { Job } from 'bullmq';
import { Dataset, DatasetStatus } from '../datasets/entities/dataset.entity.js';
import type { StorageService } from '../storage/storage.service.js';
import type { PdalService } from './pdal.service.js';
import { ProcessingProcessor } from './processing.processor.js';
import { PROCESS_DATASET_JOB } from './processing.constant.js';
import type { ProcessDatasetJob } from './processing.types.js';

const inspection = {
  summary: { summary: { num_points: 5, srs: { wkt: 'EPSG:4326' } } },
  metadata: {},
};

function fixture(status = DatasetStatus.UPLOADED) {
  let workspace = '';
  const runner = {
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue([{ locked: true }]),
    release: vi.fn(),
  };
  const dataset = {
    id: 'dataset-id',
    status,
    originalObjectKey: 'original',
    fileSize: '3',
    metadata: { existing: true },
  };
  const datasets = {
    manager: { connection: { createQueryRunner: () => runner } },
    findOneBy: vi.fn().mockResolvedValue(dataset),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const storage = {
    downloadToFile: vi.fn(async (_key: string, path: string) =>
      writeFile(path, 'las'),
    ),
    uploadFromFile: vi.fn(),
    getObjectSize: vi.fn().mockResolvedValue(4),
  };
  const pdal = {
    inspect: vi.fn().mockResolvedValue(inspection),
    convertToCopc: vi.fn(
      async (dir: string, _input: string, output: string) => {
        workspace = dir;
        await writeFile(join(dir, output), 'copc');
      },
    ),
    verifyCopc: vi.fn().mockResolvedValue(inspection),
  };
  const job = {
    name: PROCESS_DATASET_JOB,
    data: { datasetId: dataset.id },
    attemptsMade: 0,
    opts: { attempts: 3 },
    updateProgress: vi.fn(),
  };
  const processor = new ProcessingProcessor(
    datasets as unknown as Repository<Dataset>,
    storage as unknown as StorageService,
    pdal as unknown as PdalService,
  );
  return {
    processor,
    datasets,
    dataset,
    storage,
    pdal,
    runner,
    job: job as unknown as Job<ProcessDatasetJob>,
    workspace: () => workspace,
  };
}

describe('ProcessingProcessor', () => {
  it('streams, verifies and stores COPC before marking READY; removes workspace', async () => {
    const f = fixture();
    await f.processor.process(f.job);
    expect(f.storage.uploadFromFile).toHaveBeenCalledWith(
      'datasets/dataset-id/processed/cloud.copc.laz',
      expect.any(String),
    );
    expect(f.datasets.update).toHaveBeenLastCalledWith(
      'dataset-id',
      expect.objectContaining({
        status: DatasetStatus.READY,
        metadata: expect.objectContaining({
          existing: true,
          lidar: expect.objectContaining({
            processed: expect.objectContaining({ format: 'COPC', fileSize: 4 }),
          }),
        }),
      }),
    );
    await expect(access(f.workspace())).rejects.toThrow();
    expect(f.runner.release).toHaveBeenCalledOnce();
  });

  it('skips a READY dataset on redelivery', async () => {
    const f = fixture(DatasetStatus.READY);
    await f.processor.process(f.job);
    expect(f.storage.downloadToFile).not.toHaveBeenCalled();
    expect(f.datasets.update).not.toHaveBeenCalled();
    expect(f.runner.release).toHaveBeenCalledOnce();
  });

  it('rejects overlapping work without changing the dataset', async () => {
    const f = fixture();
    f.runner.query.mockResolvedValueOnce([{ locked: false }]);
    await expect(f.processor.process(f.job)).rejects.toThrow();
    expect(f.datasets.update).not.toHaveBeenCalled();
    expect(f.runner.release).toHaveBeenCalledOnce();
  });

  it('rejects incorrect downloaded size before invoking PDAL', async () => {
    const f = fixture();
    f.dataset.fileSize = '9';
    await expect(f.processor.process(f.job)).rejects.toThrow('download');
    expect(f.pdal.inspect).not.toHaveBeenCalled();
    expect(f.datasets.update).toHaveBeenLastCalledWith('dataset-id', {
      status: DatasetStatus.QUEUED,
      processingError: null,
    });
  });

  it('retries safely after metadata commit failure using the same output key', async () => {
    const f = fixture();
    f.datasets.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(f.processor.process(f.job)).rejects.toThrow('save-metadata');
    await expect(access(f.workspace())).rejects.toThrow();
    await f.processor.process(f.job);
    expect(f.storage.uploadFromFile).toHaveBeenCalledTimes(2);
    expect(f.datasets.update).toHaveBeenLastCalledWith(
      'dataset-id',
      expect.objectContaining({ status: DatasetStatus.READY }),
    );
  });

  it('does not mark READY when point counts differ', async () => {
    const f = fixture();
    f.pdal.verifyCopc.mockResolvedValueOnce({
      ...inspection,
      summary: { summary: { num_points: 4, srs: { wkt: 'EPSG:4326' } } },
    });
    await expect(f.processor.process(f.job)).rejects.toThrow('verify-copc');
    expect(f.storage.uploadFromFile).not.toHaveBeenCalled();
    await expect(access(f.workspace())).rejects.toThrow();
  });

  it('stores a sanitized final error and cleans up after failed output upload', async () => {
    const f = fixture();
    f.job.attemptsMade = 2;
    f.storage.uploadFromFile.mockRejectedValueOnce(
      new Error('https://secret-url/?credential=secret'),
    );
    await expect(f.processor.process(f.job)).rejects.toThrow('upload-copc');
    expect(f.datasets.update).toHaveBeenLastCalledWith('dataset-id', {
      status: DatasetStatus.FAILED,
      processingError: 'Processing failed at stage: upload-copc.',
    });
    await expect(access(f.workspace())).rejects.toThrow();
  });
});
