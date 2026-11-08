import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_UPLOAD_SIZE_BYTES } from '../upload.constant.js';

export class InitiateUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/\.(las|laz)$/i, {
    message: 'Only LAS and LAZ files are supported.',
  })
  originalFilename: string;

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_SIZE_BYTES)
  fileSize: number;
}
