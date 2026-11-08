import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { UploadSession } from '../../uploads/entities/upload-session.entity.js';

export enum DatasetStatus {
  UPLOADING = 'UPLOADING',
  UPLOADED = 'UPLOADED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  DELETING = 'DELETING',
}

export enum DatasetFormat {
  LAS = 'LAS',
  LAZ = 'LAZ',
  COPC = 'COPC',
}

@Entity('datasets')
@Index('IDX_datasets_status_created_at', ['status', 'createdAt'])
export class Dataset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({ type: 'varchar', length: 10 })
  fileFormat: DatasetFormat;

  @Column({ type: 'bigint' })
  fileSize: string;

  @Column({ type: 'varchar', length: 512, unique: true, nullable: true })
  originalObjectKey: string | null;

  @Column({ type: 'varchar', length: 20, default: DatasetStatus.UPLOADING })
  status: DatasetStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  processingError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => UploadSession, (uploadSession) => uploadSession.dataset)
  uploadSessions: Relation<UploadSession[]>;
}
