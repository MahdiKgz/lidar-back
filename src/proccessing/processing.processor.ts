import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset, DatasetStatus } from '../datasets/entities/dataset.entity.js';
import { StorageService } from '../storage/storage.service.js';
import { PdalService } from './pdal.service.js';
import {
  PROCESS_DATASET_JOB,
  PROCESSING_QUEUE,
} from './processing.constant.js';
import type { LidarMetadata, ProcessDatasetJob } from './processing.types.js';

@Processor(PROCESSING_QUEUE, { concurrency: 1, autorun: false })
export class ProcessingProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(
    @InjectRepository(Dataset) private readonly datasets: Repository<Dataset>,
    private readonly storage: StorageService,
    private readonly pdal: PdalService,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = Number(process.env.PROCESSING_CONCURRENCY ?? 1);
    if (process.env.PROCESSING_WORKER_ENABLED !== 'false') {
      void this.worker
        .run()
        .catch(() =>
          this.logger.error('Processing worker stopped unexpectedly.'),
        );
    }
  }

  @OnWorkerEvent('error')
  onWorkerError(): void {
    this.logger.error('Processing worker connection or execution error.');
  }

  async process(job: Job<ProcessDatasetJob>): Promise<void> {
    if (job.name !== PROCESS_DATASET_JOB) {
      throw new Error('Unsupported processing job.');
    }
    // A session-level lock also protects against overlapping stalled-job retries.
    const runner = this.datasets.manager.connection.createQueryRunner();
    let locked = false;
    let workspace: string | undefined;
    let started = false;
    let stage = 'load';
    const { datasetId } = job.data;
    try {
      await runner.connect();
      const rows: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [datasetId],
      );
      locked = rows[0]?.locked === true;
      if (!locked) throw new Error('Dataset is already being processed.');

      const dataset = await this.datasets.findOneBy({ id: datasetId });
      if (
        !dataset ||
        dataset.status === DatasetStatus.READY ||
        dataset.status === DatasetStatus.DELETING
      )
        return;
      if (
        !dataset.originalObjectKey ||
        dataset.status === DatasetStatus.UPLOADING
      ) {
        throw new Error('Dataset upload is not complete.');
      }
      await this.datasets.update(datasetId, {
        status: DatasetStatus.PROCESSING,
        processingError: null,
      });
      started = true;
      workspace = await mkdtemp(join(tmpdir(), 'lidar-processing-'));
      const inputFilename = 'original.laz';
      const outputFilename = 'cloud.copc.laz';
      const inputPath = join(workspace, inputFilename);
      const outputPath = join(workspace, outputFilename);
      const progress = async (next: string, percent: number) => {
        stage = next;
        this.logger.log(`Dataset ${datasetId}: ${stage}`);
        await job.updateProgress(percent);
      };

      await progress('download', 10);
      await this.storage.downloadToFile(dataset.originalObjectKey, inputPath);
      if (BigInt((await stat(inputPath)).size) !== BigInt(dataset.fileSize)) {
        throw new Error('Downloaded file size does not match the dataset.');
      }
      await progress('inspect-original', 25);
      const original = await this.pdal.inspect(workspace, inputFilename);
      await progress('convert', 40);
      await this.pdal.convertToCopc(workspace, inputFilename, outputFilename);
      await progress('verify-copc', 70);
      const fileSize = (await stat(outputPath)).size;
      if (fileSize === 0) throw new Error('COPC output is empty.');
      const processed = await this.pdal.verifyCopc(workspace, outputFilename);
      const originalSummary = original.summary.summary as Record<
        string,
        unknown
      >;
      const processedSummary = processed.summary.summary as Record<
        string,
        unknown
      >;
      if (originalSummary.num_points !== processedSummary.num_points) {
        throw new Error('COPC point count does not match the original.');
      }
      const objectKey = `datasets/${datasetId}/processed/cloud.copc.laz`;
      await progress('upload-copc', 85);
      await this.storage.uploadFromFile(objectKey, outputPath);
      if ((await this.storage.getObjectSize(objectKey)) !== fileSize) {
        throw new Error('Stored COPC size does not match the output.');
      }
      const lidar: LidarMetadata = {
        original,
        processed: {
          ...processed,
          format: 'COPC',
          objectKey,
          fileSize,
          processedAt: new Date().toISOString(),
        },
      };
      await progress('save-metadata', 95);
      await this.datasets.update(datasetId, {
        metadata: { ...dataset.metadata, lidar },
        status: DatasetStatus.READY,
        processingError: null,
      });
      // READY is committed before reporting completion; telemetry failure must not undo it.
      started = false;
      await job.updateProgress(100);
      this.logger.log(`Dataset ${datasetId}: ready`);
    } catch {
      if (started) {
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await this.datasets.update(datasetId, {
          status: finalAttempt ? DatasetStatus.FAILED : DatasetStatus.QUEUED,
          processingError: finalAttempt
            ? `Processing failed at stage: ${stage}.`
            : null,
        });
        this.logger.warn(`Dataset ${datasetId}: ${stage} failed`);
      }
      // Avoid storing raw SDK/child-process errors, which can contain credentials or URLs.
      throw new Error(`Dataset processing failed at stage: ${stage}.`);
    } finally {
      try {
        if (workspace) {
          await rm(workspace, { recursive: true, force: true });
        }
      } catch {
        this.logger.warn(
          `Dataset ${datasetId}: temporary workspace cleanup failed`,
        );
      } finally {
        try {
          if (locked) {
            await runner.query(
              'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
              [datasetId],
            );
          }
        } finally {
          await runner.release();
        }
      }
    }
  }
}
