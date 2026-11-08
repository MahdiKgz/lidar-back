import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dataset, DatasetStatus } from './entities/dataset.entity.js';
import {
  UploadSession,
  UploadSessionStatus,
} from '../uploads/entities/upload-session.entity.js';
import { StorageService } from '../storage/storage.service.js';
import { ProccessingService } from '../proccessing/proccessing.service.js';
import { withDatasetLock } from '../common/dataset-lock.js';
import { ListDatasetsDto } from './dto/list-datasets.dto.js';
import type { LidarMetadata } from '../proccessing/processing.types.js';

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);
  constructor(
    @InjectRepository(Dataset) private readonly datasets: Repository<Dataset>,
    private readonly storage: StorageService,
    private readonly processing: ProccessingService,
  ) {}

  async findAll(query: ListDatasetsDto) {
    const qb = this.datasets.createQueryBuilder('dataset');
    if (query.status)
      qb.andWhere('dataset.status = :status', { status: query.status });
    if (query.format)
      qb.andWhere('dataset.fileFormat = :format', { format: query.format });
    if (query.search)
      qb.andWhere('dataset.originalFilename ILIKE :search', {
        search: `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
      });
    const [data, total] = await qb
      .orderBy(`dataset.${query.sortBy}`, query.sortOrder)
      .addOrderBy('dataset.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findOne(id: string): Promise<Dataset> {
    const dataset = await this.datasets.findOneBy({ id });
    if (!dataset) throw new NotFoundException('Dataset not found.');
    return dataset;
  }

  async status(id: string) {
    const dataset = await this.findOne(id);
    let processing: Awaited<ReturnType<ProccessingService['getProgress']>> =
      null;
    try {
      processing = await this.processing.getProgress(id);
    } catch {
      /* DB status stays available during Redis outages. */
    }
    return {
      id,
      status: dataset.status,
      processingError: dataset.processingError,
      updatedAt: dataset.updatedAt,
      processing,
    };
  }

  async download(id: string, copc = false) {
    return withDatasetLock(
      this.datasets.manager.connection,
      id,
      async (manager) => {
        const dataset = await manager.getRepository(Dataset).findOneBy({ id });
        if (!dataset) throw new NotFoundException('Dataset not found.');
        if (
          dataset.status === DatasetStatus.DELETING ||
          dataset.status === DatasetStatus.UPLOADING
        )
          throw new ConflictException('Dataset is not available for download.');
        const completed = await manager
          .getRepository(UploadSession)
          .existsBy({ dataset: { id }, status: UploadSessionStatus.COMPLETED });
        if (!completed)
          throw new ConflictException('Original upload has not completed.');
        const lidar = dataset.metadata?.lidar as LidarMetadata | undefined;
        if (
          copc &&
          (dataset.status !== DatasetStatus.READY ||
            !lidar?.processed?.objectKey)
        )
          throw new ConflictException('COPC is not ready.');
        const objectKey = copc
          ? lidar!.processed.objectKey
          : dataset.originalObjectKey;
        if (!objectKey) throw new NotFoundException('Object key not found.');
        const fileSize = await this.storage.findObjectSize(objectKey);
        if (fileSize === null)
          throw new NotFoundException('Stored object not found.');
        const expiresIn = 300;
        return {
          datasetId: id,
          url: await this.storage.generateDownloadUrl(objectKey, expiresIn),
          expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000),
          fileSize: String(fileSize),
          format: copc ? 'COPC' : dataset.fileFormat,
          rangeRequests: true,
        };
      },
    );
  }

  async requeue(id: string) {
    await withDatasetLock(
      this.datasets.manager.connection,
      id,
      async (manager) => {
        const repo = manager.getRepository(Dataset);
        const dataset = await repo.findOneBy({ id });
        if (!dataset) throw new NotFoundException('Dataset not found.');
        if (
          ![
            DatasetStatus.UPLOADED,
            DatasetStatus.QUEUED,
            DatasetStatus.FAILED,
          ].includes(dataset.status)
        )
          throw new ConflictException(
            'Dataset cannot be requeued in its current state.',
          );
        if (
          !(await manager.getRepository(UploadSession).existsBy({
            dataset: { id },
            status: UploadSessionStatus.COMPLETED,
          }))
        )
          throw new ConflictException(
            'Upload must complete before processing.',
          );
        let job: Awaited<ReturnType<ProccessingService['getProgress']>> = null;
        try {
          job = await this.processing.getProgress(id);
        } catch {
          /* Persist retry intent even while Redis is down. */
        }
        if (job?.state === 'active')
          throw new ConflictException('Dataset is already processing.');
        // Commit the retry intent before contacting Redis. Reconciliation retries UPLOADED records.
        await repo.update(id, {
          status: DatasetStatus.UPLOADED,
          processingError: null,
        });
      },
    );
    let processingEnqueuePending = false;
    try {
      await this.processing.dispatchPending(id);
    } catch {
      processingEnqueuePending = true;
    }
    return {
      datasetId: id,
      status: (await this.findOne(id)).status,
      processingJobId: `dataset-${id}`,
      processingEnqueuePending,
    };
  }

  async remove(id: string) {
    const exists = await this.datasets.existsBy({ id });
    if (!exists) return;
    await withDatasetLock(
      this.datasets.manager.connection,
      id,
      async (manager) => {
        await manager
          .getRepository(Dataset)
          .update(id, { status: DatasetStatus.DELETING });
      },
    );
    // The durable DELETING state survives any partial storage cleanup or Redis outage.
    await this.cleanupDeletion(id);
  }

  private async cleanupDeletion(id: string) {
    await withDatasetLock(
      this.datasets.manager.connection,
      id,
      async (manager) => {
        const repo = manager.getRepository(Dataset);
        const dataset = await repo.findOneBy({ id });
        if (!dataset || dataset.status !== DatasetStatus.DELETING) return;
        await this.processing.removeDatasetJob(id);
        const sessions = await manager
          .getRepository(UploadSession)
          .find({ where: { dataset: { id } } });
        for (const session of sessions) {
          if (session.status !== UploadSessionStatus.COMPLETED)
            await this.storage.abortMultipartUpload(
              session.objectKey,
              session.storageUploadId,
            );
        }
        const keys = new Set([
          dataset.originalObjectKey,
          `datasets/${id}/processed/cloud.copc.laz`,
          ...sessions.map((s) => s.objectKey),
        ]);
        for (const key of keys) if (key) await this.storage.deleteObject(key);
        await repo.delete(id);
      },
    );
  }

  @Cron('*/30 * * * * *', { waitForCompletion: true })
  async reconcileDeletions() {
    const pending = await this.datasets.find({
      where: { status: DatasetStatus.DELETING },
      order: { updatedAt: 'ASC' },
      take: 100,
    });
    for (const dataset of pending) {
      try {
        await this.cleanupDeletion(dataset.id);
      } catch {
        this.logger.warn(`Dataset ${dataset.id}: deletion cleanup deferred`);
      }
    }
  }
}
