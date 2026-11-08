import { ApiProperty } from '@nestjs/swagger';
import { DatasetFormat, DatasetStatus } from '../entities/dataset.entity.js';

export class DatasetResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String }) originalFilename: string;
  @ApiProperty({ enum: DatasetFormat }) fileFormat: DatasetFormat;
  @ApiProperty({
    type: String,
    description: 'Byte count encoded as a decimal bigint string.',
  })
  fileSize: string;
  @ApiProperty({ type: String, nullable: true }) originalObjectKey:
    string | null;
  @ApiProperty({
    enum: DatasetStatus,
    description: 'DELETING persists while storage cleanup is being retried.',
  })
  status: DatasetStatus;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'metadata.lidar contains original summary/metadata and processed COPC summary/metadata, objectKey, fileSize, processedAt.',
  })
  metadata: Record<string, unknown> | null;
  @ApiProperty({ type: String, nullable: true }) processingError: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
export class DatasetListResponseDto {
  @ApiProperty({ type: [DatasetResponseDto] }) data: DatasetResponseDto[];
  @ApiProperty({ type: Number }) total: number;
  @ApiProperty({ type: Number }) page: number;
  @ApiProperty({ type: Number }) limit: number;
  @ApiProperty({ type: Number }) totalPages: number;
}
export class ProcessingProgressDto {
  @ApiProperty({ type: String }) state: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 100 }) progress: number;
  @ApiProperty({ type: Number }) attemptsMade: number;
}
export class DatasetStatusResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ enum: DatasetStatus }) status: DatasetStatus;
  @ApiProperty({ type: String, nullable: true }) processingError: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({ type: ProcessingProgressDto, nullable: true })
  processing: ProcessingProgressDto | null;
}
export class DatasetDownloadResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) datasetId: string;
  @ApiProperty({
    type: String,
    format: 'uri',
    description:
      'Temporary MinIO GET URL. Supports HTTP Range; do not persist or log.',
  })
  url: string;
  @ApiProperty({ type: Number, example: 300 }) expiresIn: number;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: String }) fileSize: string;
  @ApiProperty({ enum: DatasetFormat }) format: string;
  @ApiProperty({ type: Boolean, example: true }) rangeRequests: boolean;
}
export class RequeueResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) datasetId: string;
  @ApiProperty({ enum: DatasetStatus }) status: DatasetStatus;
  @ApiProperty({ type: String }) processingJobId: string;
  @ApiProperty({
    type: Boolean,
    description:
      'When true the durable DB intent will be retried by reconciliation.',
  })
  processingEnqueuePending: boolean;
}
export class ApiErrorDto {
  @ApiProperty({ type: Number }) statusCode: number;
  @ApiProperty({ type: String }) error: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];
  @ApiProperty({ type: String, format: 'date-time' }) timestamp: string;
  @ApiProperty({ type: String }) path: string;
}
