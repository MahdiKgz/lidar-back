import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import {
  PROCESS_DATASET_JOB,
  PROCESSING_QUEUE,
} from './processing.constant.js';
import { Dataset, DatasetStatus } from '../datasets/entities/dataset.entity.js';
import { withDatasetLock } from '../common/dataset-lock.js';
import type { ProcessDatasetJob } from './processing.types.js';

@Injectable()
export class ProccessingService {
  private readonly logger = new Logger(ProccessingService.name);
  constructor(
    @InjectQueue(PROCESSING_QUEUE)
    private readonly proccessingQueue: Queue<ProcessDatasetJob>,
    @InjectRepository(Dataset) private readonly datasets: Repository<Dataset>,
  ) {}

  async enqueueDatasetProccessing(datasetId: string, retryFinished = false) {
    const jobId = `dataset-${datasetId}`;
    const existing = await this.proccessingQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (retryFinished && (state === 'failed' || state === 'completed')) {
        await existing.retry(state, { resetAttemptsMade: true });
        return { jobId, state: 'waiting' };
      }
      return { jobId, state };
    }
    await this.proccessingQueue.add(
      PROCESS_DATASET_JOB,
      { datasetId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    );
    return { jobId, state: 'waiting' };
  }

  async dispatchPending(datasetId: string) {
    return withDatasetLock(
      this.datasets.manager.connection,
      datasetId,
      async (manager) => {
        const repo = manager.getRepository(Dataset);
        const dataset = await repo.findOneBy({ id: datasetId });
        if (
          !dataset ||
          ![
            DatasetStatus.UPLOADED,
            DatasetStatus.QUEUED,
            DatasetStatus.PROCESSING,
          ].includes(dataset.status)
        )
          return;
        const result = await this.enqueueDatasetProccessing(
          datasetId,
          dataset.status === DatasetStatus.UPLOADED,
        );
        if (result.state === 'failed' || result.state === 'completed') {
          await repo.update(datasetId, {
            status: DatasetStatus.FAILED,
            processingError:
              'Processing job finished without a committed READY result. Requeue to retry.',
          });
        } else if (result.state !== 'active') {
          await repo.update(datasetId, {
            status: DatasetStatus.QUEUED,
            processingError: null,
          });
        }
        return result;
      },
    );
  }

  async removeDatasetJob(datasetId: string): Promise<void> {
    const job = await this.proccessingQueue.getJob(`dataset-${datasetId}`);
    if (!job) return;
    if ((await job.getState()) === 'active')
      throw new ConflictException(
        'Processing job is active; deletion will be retried.',
      );
    await job.remove();
  }

  async getProgress(datasetId: string) {
    const job = await this.proccessingQueue.getJob(`dataset-${datasetId}`);
    return job
      ? {
          state: await job.getState(),
          progress: job.progress,
          attemptsMade: job.attemptsMade,
        }
      : null;
  }

  @Cron('*/15 * * * * *', { waitForCompletion: true })
  async reconcile(): Promise<void> {
    // PostgreSQL is the durable processing intent; Redis outages cannot lose it.
    const datasets = await this.datasets.find({
      where: {
        status: In([
          DatasetStatus.UPLOADED,
          DatasetStatus.QUEUED,
          DatasetStatus.PROCESSING,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: 100,
    });
    for (const dataset of datasets) {
      try {
        await this.dispatchPending(dataset.id);
      } catch (error) {
        if (!(error instanceof ConflictException))
          this.logger.warn(
            `Dataset ${dataset.id}: queue reconciliation deferred`,
          );
      }
    }
  }
}
