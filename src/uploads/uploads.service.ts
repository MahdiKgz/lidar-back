import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { extname } from 'node:path';
import {
  Dataset,
  DatasetFormat,
  DatasetStatus,
} from '../datasets/entities/dataset.entity.js';
import {
  UploadSession,
  UploadSessionStatus,
} from './entities/upload-session.entity.js';
import { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import { PresignPartsDto } from './dto/presign-parts.dto.js';
import {
  MAX_UPLOAD_SIZE_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  UPLOAD_SESSION_TTL_MS,
  PRESIGNED_URL_EXPIRES_SECONDS,
  MAX_PRESIGNED_PARTS_PER_REQUEST,
} from './upload.constant.js';
import { StorageService } from '../storage/storage.service.js';
import { ProccessingService } from '../proccessing/proccessing.service.js';
import { withDatasetLock } from '../common/dataset-lock.js';

const ACTIVE = [UploadSessionStatus.INITIATED, UploadSessionStatus.UPLOADING];

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  constructor(
    @InjectRepository(Dataset)
    private readonly datasetRepository: Repository<Dataset>,
    @InjectRepository(UploadSession)
    private readonly uploadSessionRepository: Repository<UploadSession>,
    private readonly storageService: StorageService,
    private readonly processingService: ProccessingService,
  ) {}

  async initiateUpload(dto: InitiateUploadDto) {
    if (
      !Number.isSafeInteger(dto.fileSize) ||
      dto.fileSize < 1 ||
      dto.fileSize > MAX_UPLOAD_SIZE_BYTES
    ) {
      throw new BadRequestException('Invalid file size.');
    }
    if (
      typeof dto.originalFilename !== 'string' ||
      !dto.originalFilename.length ||
      dto.originalFilename.length > 255
    ) {
      throw new BadRequestException('Invalid filename.');
    }
    const extension = extname(dto.originalFilename).toLowerCase();
    if (!['.las', '.laz'].includes(extension))
      throw new BadRequestException('Only LAS and LAZ files are supported.');
    const totalParts = Math.ceil(dto.fileSize / MULTIPART_PART_SIZE_BYTES);
    if (totalParts > 10000)
      throw new BadRequestException('Too many multipart parts.');
    let objectKey: string | undefined;
    let storageUploadId: string | undefined;
    try {
      return await this.datasetRepository.manager.connection.transaction(
        async (manager) => {
          const dataset = await manager.getRepository(Dataset).save({
            originalFilename: dto.originalFilename,
            fileFormat:
              extension === '.las' ? DatasetFormat.LAS : DatasetFormat.LAZ,
            fileSize: String(dto.fileSize),
            status: DatasetStatus.UPLOADING,
          });
          objectKey = `datasets/${dataset.id}/original${extension}`;
          storageUploadId =
            await this.storageService.initiateMultipartUpload(objectKey);
          const session = await manager.getRepository(UploadSession).save({
            dataset,
            objectKey,
            storageUploadId,
            partSize: MULTIPART_PART_SIZE_BYTES,
            totalParts,
            status: UploadSessionStatus.INITIATED,
            expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
          });
          await manager
            .getRepository(Dataset)
            .update(dataset.id, { originalObjectKey: objectKey });
          return {
            datasetId: dataset.id,
            uploadSessionId: session.id,
            originalFilename: dataset.originalFilename,
            fileSize: dataset.fileSize,
            partSize: session.partSize,
            totalParts: session.totalParts,
            expiresAt: session.expiresAt,
            status: session.status,
          };
        },
      );
    } catch (error) {
      if (objectKey && storageUploadId) {
        await this.storageService
          .abortMultipartUpload(objectKey, storageUploadId)
          .catch(() =>
            this.logger.warn(
              'Multipart cleanup failed; bucket lifecycle will retry.',
            ),
          );
      }
      throw error;
    }
  }

  private async withSession<T>(
    id: string,
    action: (
      session: UploadSession,
      manager: EntityManager,
    ) => Promise<T | HttpException>,
  ): Promise<T> {
    const found = await this.uploadSessionRepository.findOne({
      where: { id },
      relations: { dataset: true },
    });
    if (!found) throw new NotFoundException('Upload session not found.');
    const result = await withDatasetLock(
      this.datasetRepository.manager.connection,
      found.dataset.id,
      async (manager) => {
        const session = await manager
          .getRepository(UploadSession)
          .findOne({ where: { id }, relations: { dataset: true } });
        if (!session) throw new NotFoundException('Upload session not found.');
        if (session.dataset.status === DatasetStatus.DELETING)
          throw new ConflictException('Dataset is being deleted.');
        return action(session, manager);
      },
    );
    // Domain errors can be returned so terminal cleanup/state changes commit first.
    if (result instanceof HttpException) throw result;
    return result;
  }

  private async active(
    session: UploadSession,
    manager: EntityManager,
  ): Promise<HttpException | null> {
    if (!ACTIVE.includes(session.status)) {
      return session.status === UploadSessionStatus.EXPIRED
        ? new GoneException('Upload session has expired.')
        : new ConflictException(`Upload session is ${session.status}.`);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.expire(session, manager);
      return new GoneException('Upload session has expired.');
    }
    return null;
  }

  async generatePartUrls(id: string, dto: PresignPartsDto) {
    return this.withSession(id, async (session, manager) => {
      const error = await this.active(session, manager);
      if (error) return error;
      if (
        !Array.isArray(dto.partNumbers) ||
        !dto.partNumbers.length ||
        dto.partNumbers.length > MAX_PRESIGNED_PARTS_PER_REQUEST ||
        new Set(dto.partNumbers).size !== dto.partNumbers.length ||
        dto.partNumbers.some(
          (n) => !Number.isInteger(n) || n < 1 || n > session.totalParts,
        )
      ) {
        throw new BadRequestException('Invalid or duplicate part numbers.');
      }
      const expiresIn = Math.max(
        1,
        Math.min(
          PRESIGNED_URL_EXPIRES_SECONDS,
          Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        ),
      );
      const parts = await Promise.all(
        dto.partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.storageService.generatePartUrl(
            session.objectKey,
            session.storageUploadId,
            partNumber,
            expiresIn,
          ),
        })),
      );
      await manager
        .getRepository(UploadSession)
        .update(session.id, { status: UploadSessionStatus.UPLOADING });
      return { uploadSessionId: session.id, expiresIn, parts };
    });
  }

  async getUploadedParts(id: string) {
    return this.withSession(id, async (session, manager) => {
      const error = await this.active(session, manager);
      if (error) return error;
      const parts = await this.storageService.listUploadedParts(
        session.objectKey,
        session.storageUploadId,
      );
      return {
        uploadSessionId: session.id,
        partSize: session.partSize,
        totalParts: session.totalParts,
        expiresAt: session.expiresAt,
        uploadedParts: parts.map((part) => ({
          partNumber: part.PartNumber,
          etag: part.ETag,
          size: part.Size,
          valid:
            part.PartNumber !== undefined &&
            part.PartNumber >= 1 &&
            part.PartNumber <= session.totalParts &&
            part.Size ===
              Math.min(
                session.partSize,
                Number(session.dataset.fileSize) -
                  (part.PartNumber - 1) * session.partSize,
              ),
        })),
      };
    });
  }

  async completeUpload(id: string) {
    const existing = await this.uploadSessionRepository.findOne({
      where: { id },
      relations: { dataset: true },
    });
    if (existing?.status === UploadSessionStatus.COMPLETED) {
      if (existing.dataset.status === DatasetStatus.DELETING)
        throw new ConflictException('Dataset is being deleted.');
      return this.completeResponse({
        datasetId: existing.dataset.id,
        uploadSessionId: id,
        objectKey: existing.objectKey,
      });
    }
    const completed = await this.withSession(id, async (session, manager) => {
      if (
        !ACTIVE.includes(session.status) &&
        session.status !== UploadSessionStatus.COMPLETED
      ) {
        return session.status === UploadSessionStatus.EXPIRED
          ? new GoneException('Upload session has expired.')
          : new ConflictException(`Upload session is ${session.status}.`);
      }
      if (session.status !== UploadSessionStatus.COMPLETED) {
        // Recover a previous successful MinIO complete even if the DB commit failed or the session just expired.
        let size = await this.storageService.findObjectSize(session.objectKey);
        if (size === null) {
          const error = await this.active(session, manager);
          if (error) return error;
          try {
            await this.storageService.completeMultipartUpload(
              session.objectKey,
              session.storageUploadId,
              session.totalParts,
              Number(session.dataset.fileSize),
              session.partSize,
            );
          } catch (error) {
            // A transport timeout may occur after MinIO completed the upload.
            size = await this.storageService.findObjectSize(session.objectKey);
            if (size === null) {
              if (
                error instanceof Error &&
                /parts|part|size/i.test(error.message)
              ) {
                throw new ConflictException(
                  'Multipart parts are incomplete or have invalid sizes.',
                );
              }
              throw error;
            }
          }
          size = await this.storageService.getObjectSize(session.objectKey);
        }
        if (size !== Number(session.dataset.fileSize)) {
          // Delete first: failed cleanup leaves this operation retryable.
          await this.storageService.deleteObject(session.objectKey);
          await manager
            .getRepository(UploadSession)
            .update(session.id, { status: UploadSessionStatus.FAILED });
          await manager.getRepository(Dataset).update(session.dataset.id, {
            status: DatasetStatus.FAILED,
            processingError: 'Uploaded file size mismatch.',
          });
          return new ConflictException(
            'Uploaded file size does not match expected size.',
          );
        }
        if (!ACTIVE.includes(session.status))
          return new ConflictException(`Upload session is ${session.status}.`);
        await manager.getRepository(UploadSession).update(session.id, {
          status: UploadSessionStatus.COMPLETED,
          completedAt: new Date(),
        });
        await manager.getRepository(Dataset).update(session.dataset.id, {
          status: DatasetStatus.UPLOADED,
          processingError: null,
        });
      }
      return {
        datasetId: session.dataset.id,
        uploadSessionId: session.id,
        objectKey: session.objectKey,
      };
    });
    return this.completeResponse(completed);
  }

  private async completeResponse(completed: {
    datasetId: string;
    uploadSessionId: string;
    objectKey: string;
  }) {
    let processingEnqueuePending = false;
    try {
      await this.processingService.dispatchPending(completed.datasetId);
    } catch {
      processingEnqueuePending = true;
      this.logger.warn(
        `Dataset ${completed.datasetId}: enqueue pending reconciliation`,
      );
    }
    const dataset = await this.datasetRepository.findOneByOrFail({
      id: completed.datasetId,
    });
    return {
      ...completed,
      status: dataset.status,
      processingJobId: `dataset-${dataset.id}`,
      processingEnqueuePending:
        processingEnqueuePending &&
        ![
          DatasetStatus.PROCESSING,
          DatasetStatus.READY,
          DatasetStatus.FAILED,
        ].includes(dataset.status),
    };
  }

  async abortUpload(id: string) {
    return this.withSession(id, async (session, manager) => {
      if (session.status === UploadSessionStatus.COMPLETED)
        return new ConflictException('Completed uploads cannot be aborted.');
      if (session.status !== UploadSessionStatus.ABORTED) {
        await this.storageService.abortMultipartUpload(
          session.objectKey,
          session.storageUploadId,
        );
        // Also cleans an object whose storage completion succeeded before a failed DB commit.
        await this.storageService.deleteObject(session.objectKey);
        await manager
          .getRepository(UploadSession)
          .update(session.id, { status: UploadSessionStatus.ABORTED });
        await manager.getRepository(Dataset).update(session.dataset.id, {
          status: DatasetStatus.FAILED,
          processingError: 'Upload aborted.',
        });
      }
      return {
        uploadSessionId: session.id,
        status: UploadSessionStatus.ABORTED,
      };
    });
  }

  private async expire(
    session: UploadSession,
    manager: EntityManager,
  ): Promise<void> {
    // Prefer recovery over deleting a fully completed object after a DB failure.
    const size = await this.storageService.findObjectSize(session.objectKey);
    if (size !== null && size === Number(session.dataset.fileSize)) {
      await manager.getRepository(UploadSession).update(session.id, {
        status: UploadSessionStatus.COMPLETED,
        completedAt: new Date(),
      });
      await manager.getRepository(Dataset).update(session.dataset.id, {
        status: DatasetStatus.UPLOADED,
        processingError: null,
      });
      return;
    }
    await this.storageService.abortMultipartUpload(
      session.objectKey,
      session.storageUploadId,
    );
    if (size !== null)
      await this.storageService.deleteObject(session.objectKey);
    await manager
      .getRepository(UploadSession)
      .update(session.id, { status: UploadSessionStatus.EXPIRED });
    await manager.getRepository(Dataset).update(session.dataset.id, {
      status: DatasetStatus.FAILED,
      processingError: 'Upload expired.',
    });
  }

  @Cron('*/30 * * * * *', { waitForCompletion: true })
  async cleanupExpired(): Promise<void> {
    const sessions = await this.uploadSessionRepository.find({
      where: { status: In(ACTIVE), expiresAt: LessThanOrEqual(new Date()) },
      take: 100,
      order: { expiresAt: 'ASC' },
      relations: { dataset: true },
    });
    for (const session of sessions) {
      try {
        await this.withSession(session.id, async (fresh, manager) => {
          if (
            ACTIVE.includes(fresh.status) &&
            fresh.expiresAt.getTime() <= Date.now()
          )
            await this.expire(fresh, manager);
        });
      } catch {
        this.logger.warn(`Session ${session.id}: expiration cleanup deferred`);
      }
    }
  }
}
