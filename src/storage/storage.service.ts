import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type CompletedPart,
  type Part,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.getOrThrow<string>('storage.endpoint');

    const publicEndpoint = this.configService.getOrThrow<string>(
      'storage.publicEndpoint',
    );

    const credentials = {
      accessKeyId: this.configService.getOrThrow<string>('storage.accessKey'),
      secretAccessKey:
        this.configService.getOrThrow<string>('storage.secretKey'),
    };

    const region = this.configService.getOrThrow<string>('storage.region');

    this.bucket = this.configService.getOrThrow<string>('storage.bucket');

    const clientOptions = {
      region,
      credentials,
      forcePathStyle: true,
    };

    this.client = new S3Client({
      ...clientOptions,
      endpoint,
    });

    this.presignClient = new S3Client({
      ...clientOptions,
      endpoint: publicEndpoint,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
    if (this.configService.get<boolean>('storage.configureBucket', false)) {
      await this.configureBucket();
    }
  }

  private isMissing(error: unknown, code: string): boolean {
    const details = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      details.name === code ||
      (code !== 'NoSuchUpload' && details.$metadata?.httpStatusCode === 404)
    );
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!this.isMissing(error, 'NotFound')) throw error;
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (createError) {
        if (
          (createError as { name?: string }).name !== 'BucketAlreadyOwnedByYou'
        )
          throw createError;
      }
    }
  }

  async configureBucket(): Promise<void> {
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: this.configService.get<string[]>(
                'app.corsOrigin',
                ['http://localhost:5173'],
              ),
              AllowedMethods: ['GET', 'HEAD', 'PUT'],
              AllowedHeaders: ['*'],
              ExposeHeaders: [
                'ETag',
                'Content-Length',
                'Content-Range',
                'Accept-Ranges',
              ],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    // Also covers orphaned uploads created just before a process/DB failure.
    await this.client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'abort-abandoned-multipart',
              Status: 'Enabled',
              Filter: { Prefix: 'datasets/' },
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
            },
          ],
        },
      }),
    );
  }

  // Start Multipart Upload.
  async initiateMultipartUpload(
    objectKey: string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
    );

    if (!result.UploadId) {
      throw new Error('MinIO did not return an UploadId.');
    }

    return result.UploadId;
  }

  // Generate Presigned URL for an individual Part.
  async generatePartUrl(
    objectKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 3600,
  ): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      throw new Error('Invalid multipart part number.');
    }

    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(this.presignClient, command, { expiresIn });
  }

  // Retrieve all uploaded Parts, including pagination.
  async listUploadedParts(
    objectKey: string,
    uploadId: string,
  ): Promise<Part[]> {
    const parts: Part[] = [];

    let marker: string | undefined;

    while (true) {
      const result = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: objectKey,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );

      for (const part of result.Parts ?? []) {
        if (part.PartNumber !== undefined && part.ETag !== undefined) {
          parts.push({
            PartNumber: part.PartNumber,
            ETag: part.ETag,
            Size: part.Size,
          });
        }
      }

      if (!result.IsTruncated) {
        break;
      }

      if (
        result.NextPartNumberMarker === undefined ||
        result.NextPartNumberMarker === marker
      ) {
        throw new Error('Invalid multipart pagination response.');
      }

      marker = result.NextPartNumberMarker;
    }

    return parts.sort((a, b) => a.PartNumber! - b.PartNumber!);
  }
  // Complete Multipart Upload using verified storage Parts.
  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    expectedPartCount: number,
    expectedFileSize?: number,
    partSize?: number,
  ): Promise<string | undefined> {
    const parts = await this.listUploadedParts(objectKey, uploadId);

    if (parts.length !== expectedPartCount) {
      throw new Error(
        `Expected ${expectedPartCount} parts, received ${parts.length}.`,
      );
    }

    for (let i = 0; i < expectedPartCount; i++) {
      if (!parts[i].ETag?.trim() || parts[i].PartNumber !== i + 1) {
        throw new Error(`Missing multipart part ${i + 1}.`);
      }
    }

    if (expectedFileSize !== undefined && partSize !== undefined) {
      for (let i = 0; i < parts.length; i++) {
        const expectedSize = Math.min(
          partSize,
          expectedFileSize - i * partSize,
        );
        if (parts[i].Size !== expectedSize) {
          throw new Error(`Invalid size for part ${i + 1}.`);
        }
      }
    }
    const completedParts: CompletedPart[] = parts.map(
      ({ PartNumber, ETag }) => ({ PartNumber, ETag }),
    );
    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: completedParts,
        },
      }),
    );

    return result.ETag;
  }

  // Abort Multipart Upload.
  async abortMultipartUpload(
    objectKey: string,
    uploadId: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: objectKey,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (!this.isMissing(error, 'NoSuchUpload')) throw error;
    }
  }

  async findObjectSize(objectKey: string): Promise<number | null> {
    try {
      return await this.getObjectSize(objectKey);
    } catch (error) {
      if (
        this.isMissing(error, 'NotFound') ||
        this.isMissing(error, 'NoSuchKey')
      )
        return null;
      throw error;
    }
  }

  async getObjectSize(objectKey: string): Promise<number> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    if (result.ContentLength === undefined) {
      throw new Error('Unable to retrieve object size.');
    }

    return result.ContentLength;
  }
  // Generate a URL for downloading or streaming an object.
  async generateDownloadUrl(
    objectKey: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return getSignedUrl(this.presignClient, command, { expiresIn });
  }

  async downloadToFile(objectKey: string, destination: string): Promise<void> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!(result.Body instanceof Readable)) {
      throw new Error('Storage did not return a readable object stream.');
    }
    await pipeline(
      result.Body,
      createWriteStream(destination, { flags: 'wx' }),
    );
  }

  async uploadFromFile(objectKey: string, source: string): Promise<void> {
    const { size } = await stat(source);
    const body = createReadStream(source);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: body,
          ContentLength: size,
          ContentType: 'application/octet-stream',
        }),
      );
    } finally {
      body.destroy();
    }
  }

  // Delete an object.
  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
  }
}
