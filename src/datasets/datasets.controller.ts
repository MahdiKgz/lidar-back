import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatasetsService } from './datasets.service.js';
import { ListDatasetsDto } from './dto/list-datasets.dto.js';
import {
  ApiErrorDto,
  DatasetDownloadResponseDto,
  DatasetListResponseDto,
  DatasetResponseDto,
  DatasetStatusResponseDto,
  RequeueResponseDto,
} from './dto/dataset-response.dto.js';

@ApiTags('Datasets')
@ApiResponse({
  status: 400,
  type: ApiErrorDto,
  description: 'Invalid UUID or list query.',
})
@ApiResponse({
  status: 404,
  type: ApiErrorDto,
  description: 'Dataset or object not found.',
})
@ApiResponse({
  status: 409,
  type: ApiErrorDto,
  description: 'Dataset is busy or not in the required state.',
})
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Get()
  @ApiOperation({
    summary: 'List datasets with pagination, sorting and filters',
  })
  @ApiOkResponse({ type: DatasetListResponseDto })
  findAll(@Query() query: ListDatasetsDto) {
    return this.datasetsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dataset details and LiDAR metadata' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DatasetResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.findOne(id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get dataset status, job progress and final error' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DatasetStatusResponseDto })
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.status(id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Get a five-minute download URL for the original file',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DatasetDownloadResponseDto })
  download(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.download(id);
  }

  @Get(':id/copc')
  @ApiOperation({
    summary: 'Get a five-minute Range-capable URL for verified COPC',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ type: DatasetDownloadResponseDto })
  copc(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.download(id, true);
  }

  @Post(':id/requeue')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Request processing again for an uploaded, queued or failed dataset',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiAcceptedResponse({ type: RequeueResponseDto })
  requeue(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.requeue(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a dataset and its uploads/objects',
    description:
      'Idempotent: missing datasets return 204. Storage/Redis failures leave DELETING persisted; background cleanup retries automatically.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiNoContentResponse({
    description: 'Dataset and associated objects removed (or already absent).',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasetsService.remove(id);
  }
}
