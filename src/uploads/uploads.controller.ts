import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiResponse,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  InitiateUploadResponseDto,
  PresignPartsResponseDto,
  UploadedPartsResponseDto,
  CompleteUploadResponseDto,
  AbortUploadResponseDto,
} from './dto/upload-response.dto.js';
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

@ApiTags('Uploads')
@ApiResponse({ status: 400, description: 'Invalid request body or UUID.' })
@ApiResponse({ status: 404, description: 'Upload session not found.' })
@ApiResponse({
  status: 409,
  description: 'Session state conflict or uploaded size mismatch.',
})
@ApiResponse({ status: 410, description: 'Upload session expired.' })
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadService: UploadService) {}

  // Initiate Upload
  @ApiOperation({ summary: 'Create a dataset and multipart upload session' })
  @ApiBody({ type: InitiateUploadDto })
  @ApiCreatedResponse({ type: InitiateUploadResponseDto })
  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  initiateUpload(@Body() dto: InitiateUploadDto) {
    return this.uploadService.initiateUpload(dto);
  }

  // Generate Presigned URLs
  @ApiOperation({ summary: 'Get presigned binary PUT URLs for selected parts' })
  @ApiParam({ name: 'uploadSessionId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: PresignPartsResponseDto })
  @ApiBody({ type: PresignPartsDto })
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
  @ApiOperation({ summary: 'List uploaded parts for resume' })
  @ApiParam({ name: 'uploadSessionId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: UploadedPartsResponseDto })
  @Get(':uploadSessionId/parts')
  getUploadedParts(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.getUploadedParts(uploadSessionId);
  }

  // Complete Upload
  @ApiOperation({
    summary: 'Verify and complete multipart upload, then enqueue processing',
  })
  @ApiParam({ name: 'uploadSessionId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: CompleteUploadResponseDto })
  @Post(':uploadSessionId/complete')
  @HttpCode(HttpStatus.OK)
  completeUpload(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.completeUpload(uploadSessionId);
  }

  // Abort Upload
  @ApiOperation({ summary: 'Abort an incomplete upload' })
  @ApiParam({ name: 'uploadSessionId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AbortUploadResponseDto })
  @Delete(':uploadSessionId')
  @HttpCode(HttpStatus.OK)
  abortUpload(
    @Param('uploadSessionId', ParseUUIDPipe)
    uploadSessionId: string,
  ) {
    return this.uploadService.abortUpload(uploadSessionId);
  }
}
