import { Injectable } from '@nestjs/common';
import { CreateProccessingDto } from './dto/create-proccessing.dto.js';
import { UpdateProccessingDto } from './dto/update-proccessing.dto.js';
import { InjectQueue } from '@nestjs/bullmq';
import {
  PROCESS_DATASET_JOB,
  PROCESSING_QUEUE,
} from './processing.constant.js';
import { Queue } from 'bullmq';

@Injectable()
export class ProccessingService {
  constructor(
    @InjectQueue(PROCESSING_QUEUE) private readonly proccessingQueue: Queue,
  ) {}

  async enqueueDatasetProccessing(datasetId: string) {
    const job = await this.proccessingQueue.add(
      PROCESS_DATASET_JOB,
      {
        datasetId,
      },
      {
        jobId: `dataset-${datasetId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
          count: 5000,
        },
      },
    );

    return {
      jobId: String(job.id),
    };
  }
}
