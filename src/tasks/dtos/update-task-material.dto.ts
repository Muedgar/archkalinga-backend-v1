import { PartialType } from '@nestjs/swagger';
import { CreateTaskMaterialDto } from './create-task-material.dto';

export class UpdateTaskMaterialDto extends PartialType(CreateTaskMaterialDto) {}
