import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  Equals,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  validate,
} from 'class-validator';
import { DependencyType, TaskDocumentType } from '../entities';
import { TaskAssignedMemberDto } from './create-task.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PackageDocumentDto {
  @IsString()
  @Transform(trim)
  @Length(1, 160)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  attachmentNotes?: string | null;

  @IsEnum(TaskDocumentType)
  type: TaskDocumentType;

  @IsIn(['UPLOAD', 'FROM_DELIVERABLE', 'DEFINE'])
  mode: 'UPLOAD' | 'FROM_DELIVERABLE' | 'DEFINE';

  @IsOptional()
  @IsString()
  @Matches(/^file_\d+$/)
  fileKey?: string;

  @IsOptional()
  @IsUUID()
  sourceAttachmentId?: string;

  // Optional ownership assertions; ownership is derived from the attachment UUID.
  @IsOptional()
  @IsUUID()
  sourceTaskId?: string;

  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;
}

export class PackageTaskDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  title: string;

  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @IsUUID()
  statusId: string;

  @Equals('task')
  scheduleType: 'task';

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TaskAssignedMemberDto)
  assignedMembers: TaskAssignedMemberDto[] = [];

  // Deliberately ignored, even when it identifies another user.
  @Allow()
  reportee?: unknown;
}

export class PackageChecklistDto extends PackageTaskDto {
  @IsString()
  @Transform(trim)
  @Length(1, 160)
  clientId: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  plannedStartDate?: string | null;

  @IsInt()
  @Min(1)
  @Max(999999)
  durationDays = 1;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageDocumentDto)
  starterDocuments: PackageDocumentDto[] = [];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageDocumentDto)
  deliverableDocuments: PackageDocumentDto[] = [];
}

export class PackageDependencyDto {
  @IsString()
  @Length(1, 160)
  checklistClientId: string;

  @IsString()
  @Length(1, 160)
  dependsOnChecklistClientId: string;

  @IsEnum(DependencyType)
  dependencyType: DependencyType;

  @IsInt()
  lagDays = 0;
}

export class PackageBranchFromDto {
  @IsUUID()
  taskId: string;
  @IsUUID()
  checklistItemId: string;
}

export class CreateTaskPackageDto {
  @Equals('UNBRANCHED')
  checklistMode = 'UNBRANCHED' as const;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PackageBranchFromDto)
  branchFrom?: PackageBranchFromDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PackageTaskDto)
  task: PackageTaskDto;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageDocumentDto)
  generalStarterDocuments: PackageDocumentDto[] = [];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageChecklistDto)
  checklists: PackageChecklistDto[] = [];

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PackageDependencyDto)
  dependencies: PackageDependencyDto[] = [];
}

export async function parseTaskPackage(
  payload: unknown,
): Promise<CreateTaskPackageDto> {
  if (typeof payload !== 'string')
    throw new BadRequestException('payload must be a JSON string');
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new BadRequestException('payload contains invalid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('payload must contain an object');
  const dto = plainToInstance(CreateTaskPackageDto, raw);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  if (errors.length)
    throw new BadRequestException({ message: 'Invalid task package', errors });
  for (const task of [dto.task, ...dto.checklists]) {
    if (task.description) validateDescription(task.description);
  }
  if (dto.branchFrom && !dto.checklists.length)
    throw new BadRequestException(
      'A branched task requires at least one checklist',
    );
  validatePackageGraph(dto);
  const groups: [PackageDocumentDto[], TaskDocumentType][] = [
    [dto.generalStarterDocuments, TaskDocumentType.STARTER],
    ...dto.checklists.flatMap(
      (item): [PackageDocumentDto[], TaskDocumentType][] => [
        [item.starterDocuments, TaskDocumentType.STARTER],
        [item.deliverableDocuments, TaskDocumentType.DELIVERABLE],
      ],
    ),
  ];
  for (const [documents, expectedType] of groups)
    for (const document of documents) {
      const hasSource =
        document.sourceAttachmentId != null ||
        document.sourceTaskId != null ||
        document.sourceDocumentId != null;
      if (document.type !== expectedType)
        throw new BadRequestException(
          'Document type does not match its collection',
        );
      if (expectedType === TaskDocumentType.DELIVERABLE) {
        if (document.mode !== 'DEFINE' || document.fileKey != null || hasSource)
          throw new BadRequestException(
            'Deliverables must be definitions without files or sources',
          );
      } else if (document.mode === 'UPLOAD') {
        if (!document.fileKey || hasSource)
          throw new BadRequestException(
            'Uploaded starters require fileKey and no source',
          );
      } else if (document.mode === 'FROM_DELIVERABLE') {
        if (!document.sourceAttachmentId || document.fileKey != null)
          throw new BadRequestException(
            'FROM_DELIVERABLE requires the existing file UUID in sourceAttachmentId',
          );
      } else
        throw new BadRequestException(
          'Starter documents require an upload or an existing deliverable file',
        );
    }
  return dto;
}

function validateDescription(description: Record<string, unknown>): void {
  if (description.type !== 'doc')
    throw new BadRequestException('Descriptions must be TipTap documents');
  let textLength = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 50 || !node || typeof node !== 'object' || Array.isArray(node))
      throw new BadRequestException('Invalid TipTap content');
    const item = node as Record<string, unknown>;
    if (typeof item.type !== 'string')
      throw new BadRequestException('Invalid TipTap node');
    if (item.text !== undefined) {
      if (typeof item.text !== 'string')
        throw new BadRequestException('Invalid TipTap text');
      textLength += item.text.length;
    }
    if (item.content !== undefined) {
      if (!Array.isArray(item.content))
        throw new BadRequestException('Invalid TipTap content');
      item.content.forEach((child) => visit(child, depth + 1));
    }
  };
  visit(description, 0);
  if (textLength > 4000)
    throw new BadRequestException(
      'Description text cannot exceed 4000 characters',
    );
}

export function validatePackageGraph(dto: CreateTaskPackageDto): void {
  const ids = new Set(dto.checklists.map((item) => item.clientId));
  if (ids.size !== dto.checklists.length)
    throw new BadRequestException('Duplicate checklist clientId');
  const predecessors = new Map<string, string[]>();
  const edges = new Set<string>();
  for (const edge of dto.dependencies) {
    const { checklistClientId: to, dependsOnChecklistClientId: from } = edge;
    if (!ids.has(from) || !ids.has(to) || from === to)
      throw new BadRequestException('Invalid checklist dependency reference');
    const key = JSON.stringify([from, to]);
    if (edges.has(key)) throw new BadRequestException('Duplicate dependency');
    edges.add(key);
    predecessors.set(to, [...(predecessors.get(to) ?? []), from]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new BadRequestException(
        'Checklist dependencies cannot contain cycles',
      );
    if (visited.has(id)) return;
    visiting.add(id);
    for (const from of predecessors.get(id) ?? []) visit(from);
    visiting.delete(id);
    visited.add(id);
  };
  ids.forEach(visit);
}
