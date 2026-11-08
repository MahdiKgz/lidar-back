import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DatasetFormat, DatasetStatus } from '../entities/dataset.entity.js';

export class ListDatasetsDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: DatasetStatus })
  @IsOptional()
  @IsEnum(DatasetStatus)
  status?: DatasetStatus;

  @ApiPropertyOptional({ enum: DatasetFormat })
  @IsOptional()
  @IsEnum(DatasetFormat)
  format?: DatasetFormat;

  @ApiPropertyOptional({
    type: String,
    maxLength: 255,
    description: 'Case-insensitive literal filename search.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'originalFilename', 'fileSize'],
    default: 'createdAt',
  })
  @IsIn(['createdAt', 'updatedAt', 'originalFilename', 'fileSize'])
  sortBy: 'createdAt' | 'updatedAt' | 'originalFilename' | 'fileSize' =
    'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'DESC';
}
