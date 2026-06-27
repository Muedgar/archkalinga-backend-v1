import { PartialType } from '@nestjs/swagger';
import { CreateTaskDocumentDto } from './create-task-document.dto';

export class UpdateTaskDocumentDto extends PartialType(CreateTaskDocumentDto) {}
