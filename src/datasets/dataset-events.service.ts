import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  type MessageEvent,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type QueryRunner } from 'typeorm';
import { Subject, Observable, merge, interval, map } from 'rxjs';
import { Dataset } from './entities/dataset.entity.js';

type Notification = { channel: string; payload?: string };
type PgConnection = {
  on(event: string, handler: (...args: any[]) => void): void;
  removeListener(event: string, handler: (...args: any[]) => void): void;
};

@Injectable()
export class DatasetEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatasetEventsService.name);
  private readonly events = new Subject<MessageEvent>();
  private runner?: QueryRunner;
  private connection?: PgConnection;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private clients = 0;
  constructor(
    @InjectRepository(Dataset) private readonly datasets: Repository<Dataset>,
  ) {}

  onModuleInit() {
    void this.listen();
  }
  private readonly notification = (event: Notification) => {
    if (event.channel !== 'lidar_dataset_changes' || !event.payload) return;
    try {
      const value = JSON.parse(event.payload) as {
        id: string;
        operation: string;
      };
      if (value.operation === 'DELETE')
        this.events.next({ type: 'dataset-deleted', data: { id: value.id } });
      else void this.publishDataset(value.id, value.operation === 'INSERT');
    } catch {
      this.logger.warn('Invalid dataset notification.');
    }
  };
  private readonly disconnected = () => {
    if (this.stopped || this.retry) return;
    this.events.next({ type: 'sync-required', data: {} });
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.listen();
    }, 3000);
  };
  private async listen() {
    await this.release();
    if (this.stopped) return;
    const runner = this.datasets.manager.connection.createQueryRunner();
    this.runner = runner;
    try {
      this.connection = (await runner.connect()) as PgConnection;
      this.connection.on('notification', this.notification);
      this.connection.on('error', this.disconnected);
      this.connection.on('end', this.disconnected);
      await runner.query('LISTEN lidar_dataset_changes');
      if (this.stopped) {
        await this.release();
        return;
      }
      this.events.next({ type: 'sync-required', data: {} });
    } catch {
      this.logger.warn('Dataset event listener disconnected; reconnecting.');
      this.disconnected();
    }
  }
  private async publishDataset(id: string, created: boolean) {
    if (!this.clients) return;
    try {
      const dataset = await this.datasets.findOne({
        where: { id },
        select: {
          id: true,
          originalFilename: true,
          fileSize: true,
          fileFormat: true,
          status: true,
          processingError: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (dataset)
        this.events.next({
          type: created ? 'dataset-created' : 'dataset-updated',
          data: dataset,
        });
    } catch {
      this.events.next({ type: 'sync-required', data: {} });
    }
  }
  progress(datasetId: string, progress: unknown) {
    if (this.clients)
      this.events.next({
        type: 'dataset-progress',
        data: { id: datasetId, progress },
      });
  }
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.clients++;
      const subscription = merge(
        this.events,
        interval(15000).pipe(map(() => ({ type: 'heartbeat', data: {} }))),
      ).subscribe(subscriber);
      subscriber.next({ type: 'connected', data: {}, retry: 3000 });
      return () => {
        subscription.unsubscribe();
        this.clients--;
      };
    });
  }
  private async release() {
    if (this.connection) {
      this.connection.removeListener('notification', this.notification);
      this.connection.removeListener('error', this.disconnected);
      this.connection.removeListener('end', this.disconnected);
      this.connection = undefined;
    }
    if (this.runner) {
      const runner = this.runner;
      this.runner = undefined;
      await runner.release().catch(() => undefined);
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.events.complete();
    await this.release();
  }
}
