import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DatasetStatus } from '../../datasets/entities/dataset.entity.js';
import { UploadSessionStatus } from '../entities/upload-session.entity.js';

export class InitiateUploadResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) datasetId: string;
  @ApiProperty({ type: String, format: 'uuid' }) uploadSessionId: string;
  @ApiProperty({ type: String }) originalFilename: string;
  @ApiProperty({
    type: String,
    example: '671811028',
    description: 'Byte count as a decimal string (PostgreSQL bigint).',
  })
  fileSize: string;
  @ApiProperty({ type: Number, example: 16777216 }) partSize: number;
  @ApiProperty({ type: Number, example: 41 }) totalParts: number;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ enum: UploadSessionStatus }) status: UploadSessionStatus;
}

export class PresignedPartDto {
  @ApiProperty({ type: Number, example: 1 }) partNumber: number;
  @ApiProperty({
    type: String,
    format: 'uri',
    description:
      'Temporary URL for a direct binary PUT to MinIO. Never log or persist it.',
  })
  url: string;
}
export class PresignPartsResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) uploadSessionId: string;
  @ApiProperty({ type: Number, example: 900 }) expiresIn: number;
  @ApiProperty({ type: [PresignedPartDto] }) parts: PresignedPartDto[];
}
export class UploadedPartDto {
  @ApiProperty({ type: Number, description: 'Actual part size in MinIO.' })
  size: number;
  @ApiProperty({
    type: Boolean,
    description:
      'Whether this part has the expected byte count; reupload invalid parts.',
  })
  valid: boolean;
  @ApiProperty({ type: Number }) partNumber: number;
  @ApiProperty({ type: String, description: 'ETag reported by MinIO.' })
  etag: string;
}
export class UploadedPartsResponseDto {
  @ApiProperty({ type: Number }) partSize: number;
  @ApiProperty({ type: Number }) totalParts: number;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: String, format: 'uuid' }) uploadSessionId: string;
  @ApiProperty({ type: [UploadedPartDto] }) uploadedParts: UploadedPartDto[];
}
export class CompleteUploadResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) datasetId: string;
  @ApiProperty({ type: String, format: 'uuid' }) uploadSessionId: string;
  @ApiProperty({ enum: DatasetStatus }) status: DatasetStatus;
  @ApiProperty({ type: String }) objectKey: string;
  @ApiPropertyOptional({
    type: String,
    description: 'Deterministic processing job identifier.',
  })
  processingJobId?: string;

  @ApiProperty({
    type: Boolean,
    description: 'True when background reconciliation must retry enqueue.',
  })
  processingEnqueuePending: boolean;
}
export class AbortUploadResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) uploadSessionId: string;
  @ApiProperty({ enum: UploadSessionStatus }) status: UploadSessionStatus;
}
