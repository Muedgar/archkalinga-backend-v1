import { PartialType } from '@nestjs/swagger';
import { CreateTaskResourceAllocationDto } from './create-task-resource-allocation.dto';

export class UpdateTaskResourceAllocationDto extends PartialType(
  CreateTaskResourceAllocationDto,
) {}
