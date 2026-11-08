import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
} from './upload.constant.js';

import { extname } from 'node:path';
import { StorageService } from '../storage/storage.service.js';
import { ProccessingService } from '../proccessing/proccessing.service.js';

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

  // 1. Initiate Upload
  async initiateUpload(dto: InitiateUploadDto) {
    if (
      !Number.isSafeInteger(dto.fileSize) ||
      dto.fileSize < 1 ||
      dto.fileSize > MAX_UPLOAD_SIZE_BYTES
    ) {
      throw new BadRequestException('Invalid file size.');
    }

    const extension = extname(dto.originalFilename).toLowerCase();

    if (extension !== '.las' && extension !== '.laz') {
      throw new BadRequestException('Only LAS and LAZ files are supported.');
    }

    const fileFormat =
      extension === '.las' ? DatasetFormat.LAS : DatasetFormat.LAZ;

    const totalParts = Math.ceil(dto.fileSize / MULTIPART_PART_SIZE_BYTES);

    if (totalParts > 10000) {
      throw new BadRequestException(
        'File exceeds maximum multipart part count.',
      );
    }

    // Create Dataset
    const dataset = await this.datasetRepository.save({
      originalFilename: dto.originalFilename,
      fileFormat,
      fileSize: String(dto.fileSize),
      status: DatasetStatus.UPLOADING,
    });

    const objectKey = `datasets/${dataset.id}/original${extension}`;

    let storageUploadId: string | undefined;
    let savedSessionId: string | undefined;

    try {
      // Initiate Multipart Upload in MinIO
      storageUploadId =
        await this.storageService.initiateMultipartUpload(objectKey);

      // Create and save UploadSession in PostgreSQL
      const uploadSession = await this.uploadSessionRepository.save({
        dataset,
        objectKey,
        storageUploadId,
        partSize: MULTIPART_PART_SIZE_BYTES,
        totalParts,
        status: UploadSessionStatus.INITIATED,
        expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
      });

      savedSessionId = uploadSession.id;

      dataset.originalObjectKey = objectKey;

      await this.datasetRepository.save(dataset);

      return {
        datasetId: dataset.id,
        uploadSessionId: uploadSession.id,
        originalFilename: dataset.originalFilename,
        fileSize: dataset.fileSize,
        partSize: uploadSession.partSize,
        totalParts: uploadSession.totalParts,
        expiresAt: uploadSession.expiresAt,
        status: uploadSession.status,
      };
    } catch (error) {
      // Abort MinIO Multipart Upload
      if (storageUploadId) {
        try {
          await this.storageService.abortMultipartUpload(
            objectKey,
            storageUploadId,
          );
        } catch (cleanupError) {
          this.logger.error(
            'Failed to abort MinIO multipart upload.',
            cleanupError instanceof Error
              ? cleanupError.stack
              : String(cleanupError),
          );
        }
      }

      // Remove UploadSession if created
      if (savedSessionId) {
        await this.uploadSessionRepository.delete(savedSessionId);
      }

      // Remove Dataset
      await this.datasetRepository.delete(dataset.id);

      throw error;
    }
  }

  // 2. Generate Presigned URLs
  async generatePartUrls(uploadSessionId: string, dto: PresignPartsDto) {
    const session = await this.findSession(uploadSessionId);

    await this.assertSessionActive(session);

    for (const partNumber of dto.partNumbers) {
      if (partNumber > session.totalParts) {
        throw new BadRequestException(
          `Part number ${partNumber} exceeds total parts.`,
        );
      }
    }

    const parts = await Promise.all(
      dto.partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.generatePartUrl(
          session.objectKey,
          session.storageUploadId,
          partNumber,
          PRESIGNED_URL_EXPIRES_SECONDS,
        ),
      })),
    );

    if (session.status === UploadSessionStatus.INITIATED) {
      session.status = UploadSessionStatus.UPLOADING;
      await this.uploadSessionRepository.save(session);
    }

    return {
      uploadSessionId: session.id,
      expiresIn: PRESIGNED_URL_EXPIRES_SECONDS,
      parts,
    };
  }

  // 3. Get Uploaded Parts
  async getUploadedParts(uploadSessionId: string) {
    const session = await this.findSession(uploadSessionId);

    await this.assertSessionActive(session);

    const parts = await this.storageService.listUploadedParts(
      session.objectKey,
      session.storageUploadId,
    );

    return {
      uploadSessionId: session.id,
      uploadedParts: parts.map((part) => ({
        partNumber: part.PartNumber,
        etag: part.ETag,
      })),
    };
  }

  // 4. Complete Upload
  async completeUpload(uploadSessionId: string) {
    const session = await this.findSession(uploadSessionId);

    if (session.status === UploadSessionStatus.COMPLETED) {
      return {
        datasetId: session.dataset.id,
        uploadSessionId: session.id,
        status: DatasetStatus.UPLOADED,
        objectKey: session.objectKey,
      };
    }

    await this.assertSessionActive(session);

    // Complete Multipart Upload in MinIO
    await this.storageService.completeMultipartUpload(
      session.objectKey,
      session.storageUploadId,
      session.totalParts,
    );

    // Verify uploaded file size
    const actualSize = await this.storageService.getObjectSize(
      session.objectKey,
    );

    const expectedSize = Number(session.dataset.fileSize);

    if (actualSize !== expectedSize) {
      session.status = UploadSessionStatus.FAILED;
      session.dataset.status = DatasetStatus.FAILED;

      session.dataset.processingError = `File size mismatch. Expected ${expectedSize}, received ${actualSize}.`;

      await Promise.all([
        this.uploadSessionRepository.save(session),
        this.datasetRepository.save(session.dataset),
      ]);

      try {
        await this.storageService.deleteObject(session.objectKey);
      } catch (error) {
        this.logger.error(
          'Failed to delete invalid uploaded object.',
          error instanceof Error ? error.stack : String(error),
        );
      }

      throw new ConflictException(
        'Uploaded file size does not match expected size.',
      );
    }

    // Update database status
    session.status = UploadSessionStatus.COMPLETED;
    session.completedAt = new Date();

    session.dataset.status = DatasetStatus.UPLOADED;

    await Promise.all([
      this.uploadSessionRepository.save(session),
      this.datasetRepository.save(session.dataset),
    ]);

    const { jobId } = await this.processingService.enqueueDatasetProccessing(
      session.dataset.id,
    );

    return {
      datasetId: session.dataset.id,
      uploadSessionId: session.id,
      status: DatasetStatus.UPLOADED,
      objectKey: session.objectKey,
      processingJobId: jobId,
    };
  }

  // 5. Abort Upload
  async abortUpload(uploadSessionId: string) {
    const session = await this.findSession(uploadSessionId);

    if (session.status === UploadSessionStatus.COMPLETED) {
      throw new ConflictException('Completed uploads cannot be aborted.');
    }

    if (session.status === UploadSessionStatus.ABORTED) {
      return {
        uploadSessionId: session.id,
        status: session.status,
      };
    }

    await this.storageService.abortMultipartUpload(
      session.objectKey,
      session.storageUploadId,
    );

    session.status = UploadSessionStatus.ABORTED;
    session.dataset.status = DatasetStatus.FAILED;

    await Promise.all([
      this.uploadSessionRepository.save(session),
      this.datasetRepository.save(session.dataset),
    ]);

    return {
      uploadSessionId: session.id,
      status: session.status,
    };
  }

  // Helpers

  private async findSession(uploadSessionId: string): Promise<UploadSession> {
    const session = await this.uploadSessionRepository.findOne({
      where: {
        id: uploadSessionId,
      },
      relations: {
        dataset: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found.');
    }

    return session;
  }

  private async assertSessionActive(session: UploadSession): Promise<void> {
    if (
      session.status !== UploadSessionStatus.INITIATED &&
      session.status !== UploadSessionStatus.UPLOADING
    ) {
      throw new ConflictException(`Upload session is ${session.status}.`);
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      session.status = UploadSessionStatus.EXPIRED;
      session.dataset.status = DatasetStatus.FAILED;

      await Promise.all([
        this.uploadSessionRepository.save(session),
        this.datasetRepository.save(session.dataset),
      ]);

      throw new GoneException('Upload session has expired.');
    }
  }
}
