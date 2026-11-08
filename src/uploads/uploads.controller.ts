import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { UploadService } from './uploads.service.js';

import { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import { PresignPartsDto } from './dto/presign-parts.dto.js';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadService: UploadService) {}

  // Initiate Upload
  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  initiateUpload(@Body() dto: InitiateUploadDto) {
    return this.uploadService.initiateUpload(dto);
  }

  // Generate Presigned URLs
  @Post(':uploadSessionId/parts/presign')
  @HttpCode(HttpStatus.OK)
  generatePartUrls(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,

    @Body() dto: PresignPartsDto,
  ) {
    return this.uploadService.generatePartUrls(uploadSessionId, dto);
  }

  // Get Uploaded Parts
  @Get(':uploadSessionId/parts')
  getUploadedParts(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.getUploadedParts(uploadSessionId);
  }

  // Complete Upload
  @Post(':uploadSessionId/complete')
  @HttpCode(HttpStatus.OK)
  completeUpload(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.completeUpload(uploadSessionId);
  }

  // Abort Upload
  @Delete(':uploadSessionId')
  @HttpCode(HttpStatus.OK)
  abortUpload(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.abortUpload(uploadSessionId);
  }
}
