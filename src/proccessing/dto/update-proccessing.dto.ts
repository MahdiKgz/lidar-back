import { PartialType } from '@nestjs/mapped-types';
import { CreateProccessingDto } from './create-proccessing.dto.js';

export class UpdateProccessingDto extends PartialType(CreateProccessingDto) {}
