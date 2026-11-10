import {
  QueueEventsHost,
  QueueEventsListener,
  OnQueueEvent,
} from '@nestjs/bullmq';
import { PROCESSING_QUEUE } from '../proccessing/processing.constant.js';
import { DatasetEventsService } from './dataset-events.service.js';

@QueueEventsListener(PROCESSING_QUEUE)
export class DatasetQueueEvents extends QueueEventsHost {
  constructor(private readonly events: DatasetEventsService) {
    super();
  }
  @OnQueueEvent('progress')
  progress({ jobId, data }: { jobId: string; data: unknown }) {
    if (jobId.startsWith('dataset-'))
      this.events.progress(jobId.slice(8), data);
  }
  @OnQueueEvent('error')
  onError() {
    /* BullMQ reconnects; PostgreSQL status delivery remains available. */
  }
}
