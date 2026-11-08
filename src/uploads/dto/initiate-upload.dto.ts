import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    type: String,
    example: 'survey.laz',
    maxLength: 255,
    pattern: '\\.[lL][aA][sSzZ]$',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/\.(las|laz)$/i, {
    message: 'Only LAS and LAZ files are supported.',
  })
  originalFilename: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: MAX_UPLOAD_SIZE_BYTES,
    example: 671811028,
    description: 'Size in bytes; maximum 1 GiB.',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_SIZE_BYTES)
  fileSize: number;
}
