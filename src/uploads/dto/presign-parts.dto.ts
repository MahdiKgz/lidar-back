import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { MAX_PRESIGNED_PARTS_PER_REQUEST } from '../upload.constant.js';

export class PresignPartsDto {
  @ApiProperty({
    type: [Number],
    example: [1, 2, 3],
    minItems: 1,
    maxItems: MAX_PRESIGNED_PARTS_PER_REQUEST,
    uniqueItems: true,
    description: 'Integer part numbers from 1 to totalParts (at most 10000).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(MAX_PRESIGNED_PARTS_PER_REQUEST)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10000, { each: true })
  partNumbers: number[];
}
