import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Dataset } from '../../datasets/entities/dataset.entity.js';

export enum UploadSessionStatus {
  INITIATED = 'INITIATED',
  UPLOADING = 'UPLOADING',
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

@Entity('upload_sessions')
@Index('IDX_upload_sessions_dataset_id', ['dataset'])
export class UploadSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Dataset, (dataset) => dataset.uploadSessions, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dataset_id' })
  dataset: Relation<Dataset>;

  @Column({ type: 'varchar', length: 512 })
  objectKey: string;

  @Column({ type: 'varchar', length: 255 })
  storageUploadId: string;

  @Column({ type: 'integer' })
  partSize: number;

  @Column({ type: 'integer' })
  totalParts: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: UploadSessionStatus.INITIATED,
  })
  status: UploadSessionStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
