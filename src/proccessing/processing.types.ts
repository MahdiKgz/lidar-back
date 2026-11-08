export interface ProcessDatasetJob {
  datasetId: string;
}

export interface PdalInspection {
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface LidarMetadata {
  original: PdalInspection;
  processed: PdalInspection & {
    format: 'COPC';
    objectKey: string;
    fileSize: number;
    processedAt: string;
  };
}
