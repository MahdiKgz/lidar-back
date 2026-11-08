import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { DatasetsService } from './datasets.service.js';
import { CreateDatasetDto } from './dto/create-dataset.dto.js';
import { UpdateDatasetDto } from './dto/update-dataset.dto.js';

@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Post()
  create(@Body() createDatasetDto: CreateDatasetDto) {
    return this.datasetsService.create(createDatasetDto);
  }

  @Get()
  findAll() {
    return this.datasetsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.datasetsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDatasetDto: UpdateDatasetDto) {
    return this.datasetsService.update(+id, updateDatasetDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.datasetsService.remove(+id);
  }
}
