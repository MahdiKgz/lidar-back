import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type CompletedPart,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

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
  }

  // Check and create bucket if it does not exist.
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
        }),
      );

      this.logger.log(`Bucket "${this.bucket}" created successfully.`);
    } catch (error) {
      const details = error as {
        name?: string;
        Code?: string;
        $metadata?: {
          httpStatusCode?: number;
        };
      };

      const errorCode = details.name ?? details.Code;

      if (errorCode === 'BucketAlreadyOwnedByYou') {
        this.logger.log(`Bucket "${this.bucket}" already exists.`);

        return;
      }

      this.logger.error(`Failed to initialize bucket "${this.bucket}".`, {
        errorCode,
        statusCode: details.$metadata?.httpStatusCode,
      } as any);

      throw error;
    }
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
  ): Promise<CompletedPart[]> {
    const parts: CompletedPart[] = [];

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
          });
        }
      }

      if (!result.IsTruncated) {
        break;
      }

      if (result.NextPartNumberMarker === undefined) {
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
  ): Promise<string | undefined> {
    const parts = await this.listUploadedParts(objectKey, uploadId);

    if (parts.length !== expectedPartCount) {
      throw new Error(
        `Expected ${expectedPartCount} parts, received ${parts.length}.`,
      );
    }

    for (let i = 0; i < expectedPartCount; i++) {
      if (parts[i].PartNumber !== i + 1) {
        throw new Error(`Missing multipart part ${i + 1}.`);
      }
    }

    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts,
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
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
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
