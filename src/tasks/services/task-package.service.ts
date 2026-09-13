import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { EntityManager, In, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { MinioService, UploadableFile } from 'src/common/services';
import { Project, ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { User } from 'src/users/entities';
import {
  CreateTaskPackageDto,
  PackageDocumentDto,
  PackageTaskDto,
  parseTaskPackage,
} from '../dtos/create-task-package.dto';
import {
  ChecklistDependency,
  ScheduleType,
  Task,
  TaskActionType,
  TaskActivitySchedule,
  TaskAssignee,
  TaskChecklistBranchStatus,
  TaskChecklistItem,
  TaskDocument,
  TaskDocumentAttachment,
  TaskDocumentType,
} from '../entities';
import { ProjectStatus, ProjectTaskType } from '../project-config';
import { TaskAuthService } from './task-auth.service';
import { TaskActivityService } from './task-activity.service';
import { TaskRankingService } from './task-ranking.service';
import { TaskMembersService, ProjectRoleContext } from './task-members.service';
import { TaskProgressService } from './task-progress.service';
import { TaskWbsService } from './task-wbs.service';
import { ScheduleCalculationService } from './schedule-calculation.service';
import { TaskCompletionTransitionService } from './task-completion-transition.service';

type PackageFile = UploadableFile & { fieldname: string };
type StoredFile = { bucketName: string; fileName: string };

@Injectable()
export class TaskPackageService {
  private readonly logger = new Logger(TaskPackageService.name);

  constructor(
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    private readonly auth: TaskAuthService,
    private readonly activity: TaskActivityService,
    private readonly ranking: TaskRankingService,
    private readonly members: TaskMembersService,
    private readonly progress: TaskProgressService,
    private readonly wbs: TaskWbsService,
    private readonly schedule: ScheduleCalculationService,
    private readonly transition: TaskCompletionTransitionService,
    private readonly storage: MinioService,
    private readonly config: ConfigService,
  ) {}

  async create(
    projectId: string,
    payload: unknown,
    files: PackageFile[],
    user: RequestUser,
  ) {
    const dto = await parseTaskPackage(payload);
    const fileMap = this.validateFiles(dto, files);
    const { project } = await this.auth.verifyProjectPermission(
      projectId,
      user,
      'create',
    );
    if (dto.branchFrom)
      await this.auth.assertTaskChecklistBranchAllowed({
        projectId,
        taskId: dto.branchFrom.taskId,
        requestUser: user,
      });
    // Track predetermined object names before upload, including ambiguous upload failures.
    const attemptedUploads: StoredFile[] = [];
    try {
      return await this.taskRepo.manager.transaction(async (tx) => {
        const actor = await tx.findOneOrFail(User, { where: { id: user.id } });
        let sourceItem: TaskChecklistItem | null = null;
        let sourceOwner: Task | null = null;
        if (dto.branchFrom) {
          sourceItem = await tx.findOne(TaskChecklistItem, {
            where: {
              id: dto.branchFrom.checklistItemId,
              taskId: dto.branchFrom.taskId,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (!sourceItem)
            throw new NotFoundException(
              'Source checklist not found on the specified task',
            );
          sourceOwner = await tx.findOne(Task, {
            where: { id: sourceItem.taskId, projectId },
            relations: ['assignees', 'project'],
          });
          if (
            !sourceOwner ||
            sourceOwner.deletedAt ||
            sourceOwner.supersededByTaskId ||
            !(await this.auth.canViewTask(sourceOwner, user))
          )
            throw new ForbiddenException('Source checklist is unavailable');
          if (
            sourceItem.branchedTaskId ||
            sourceItem.branchStatus === TaskChecklistBranchStatus.BRANCHED
          )
            throw new ConflictException('Checklist is already branched');
          if (sourceItem.completed || sourceOwner.completed)
            throw new ConflictException(
              'Completed checklist work must be reopened before branching',
            );
        }
        const taskInputs = [dto.task, ...dto.checklists];
        const statuses = await tx.find(ProjectStatus, {
          where: {
            projectId,
            id: In([...new Set(taskInputs.map((t) => t.statusId))]),
          },
        });
        const statusMap = new Map(
          statuses.map((status) => [status.id, status]),
        );
        if (taskInputs.some((t) => !statusMap.get(t.statusId)?.isActive))
          throw new BadRequestException('Invalid or inactive project status');
        const taskType = await tx.findOne(ProjectTaskType, {
          where: { projectId, isDefault: true },
        });
        if (!taskType)
          throw new BadRequestException('Project has no default task type');
        if (
          statusMap.get(dto.task.statusId)!.isDone &&
          dto.checklists.some((t) => !statusMap.get(t.statusId)!.isDone)
        )
          throw new BadRequestException(
            'A completed parent cannot contain incomplete checklist tasks',
          );

        const userIds = [
          ...new Set([
            actor.id,
            ...taskInputs.flatMap((t) =>
              t.assignedMembers.map((m) => m.userId),
            ),
          ]),
        ];
        const memberships = await tx.find(ProjectMembership, {
          where: {
            projectId,
            userId: In(userIds),
            status: MembershipStatus.ACTIVE,
          },
          relations: ['user', 'projectRole'],
        });
        const memberMap = new Map(memberships.map((m) => [m.userId, m]));
        for (const input of taskInputs) {
          if (
            new Set(input.assignedMembers.map((m) => m.userId)).size !==
            input.assignedMembers.length
          )
            throw new BadRequestException('Duplicate assignee');
          for (const ref of input.assignedMembers) {
            const member = memberMap.get(ref.userId);
            if (
              !member?.user ||
              !member.projectRole?.status ||
              (ref.projectRoleId && ref.projectRoleId !== member.projectRoleId)
            )
              throw new BadRequestException(
                'Assignee and role must match an active project membership',
              );
          }
        }
        const documents = this.allDocuments(dto);
        const sources = await this.resolveSources(
          tx,
          projectId,
          documents,
          user,
        );
        // No database creation or object upload precedes package-wide validation.
        const uploaded = new Map<string, StoredFile>();
        for (const [key, file] of fileMap) {
          const target = {
            bucketName: (
              this.config.get<string>('TASK_DOCUMENTS_BUCKET') ||
              'task-documents'
            )
              .trim()
              .toLowerCase(),
            fileName: `${projectId}/packages/${randomUUID()}/${basename(file.originalname)}`,
          };
          attemptedUploads.push(target);
          await this.storage.uploadFile({ ...target, file });
          uploaded.set(key, target);
        }

        const parent = await this.createTask(
          tx,
          project,
          actor,
          dto.task,
          taskType,
          memberMap,
          sourceOwner,
        );
        const items: TaskChecklistItem[] = [];
        const itemMap = new Map<string, TaskChecklistItem>();
        await this.createDocuments(
          tx,
          parent,
          actor,
          dto.generalStarterDocuments,
          uploaded,
          sources,
        );
        for (const input of dto.checklists) {
          const completed = statusMap.get(input.statusId)!.isDone === true;
          const item = await tx.save(
            tx.create(TaskChecklistItem, {
              task: parent,
              taskId: parent.id,
              text: input.title,
              description: input.description ?? null,
              statusId: input.statusId,
              orderIndex: items.length,
              packageManaged: true,
              assignedMembers: input.assignedMembers,
              reporteeUserId: actor.id,
              durationDays: input.durationDays,
              earliestStartDate: input.plannedStartDate ?? null,
              completed,
              completedByUserId: completed ? actor.id : null,
              completedAt: completed ? new Date() : null,
              branchedTaskId: null,
              branchStatus: TaskChecklistBranchStatus.FLAT,
            }),
          );
          items.push(item);
          itemMap.set(input.clientId, item);
          await this.createDocuments(
            tx,
            parent,
            actor,
            [...input.starterDocuments, ...input.deliverableDocuments],
            uploaded,
            sources,
            item.id,
          );
        }
        for (const edge of dto.dependencies)
          await tx.save(
            tx.create(ChecklistDependency, {
              checklistItemId: itemMap.get(edge.checklistClientId)!.id,
              dependsOnChecklistItemId: itemMap.get(
                edge.dependsOnChecklistClientId,
              )!.id,
              dependencyType: edge.dependencyType,
              lagDays: edge.lagDays,
            }),
          );
        if (sourceItem && sourceOwner) {
          sourceItem.branchedTaskId = parent.id;
          sourceItem.branchStatus = TaskChecklistBranchStatus.BRANCHED;
          sourceItem.branchedByUserId = actor.id;
          sourceItem.branchedAt = new Date();
          await tx.save(TaskChecklistItem, sourceItem);
          await this.activity.log(
            tx,
            sourceOwner,
            actor,
            TaskActionType.CHECKLIST_UPDATED,
            {
              operation: 'checklist_branched_from_package',
              itemId: sourceItem.id,
              branchedTaskId: parent.id,
            },
          );
        }
        const targetStatus = statusMap.get(parent.statusId)!;
        if (targetStatus.isDone)
          await this.transition.applyTransition(tx, {
            projectId,
            task: parent,
            targetStatus,
            actorUser: actor,
          });
        await this.progress.recalculateProjectTaskProgress(tx, projectId);
        await this.schedule.recalculateProject(
          projectId,
          { triggerTaskId: parent.id, triggerType: 'task-package-create' },
          tx,
        );
        for (const task of [parent]) {
          await this.activity.log(
            tx,
            task,
            actor,
            TaskActionType.TASK_CREATED,
            { title: task.title, packageParentTaskId: parent.id },
          );
        }
        // Serialize within the transaction: serialization/query failures also roll back.
        const saved = await tx.find(Task, {
          where: { id: In([parent.id]) },
          relations: [
            'status',
            'taskType',
            'reporteeUser',
            'assignees',
            'assignees.user',
            'activitySchedule',
            'checklistItems',
            'dependencyEdges',
          ],
        });
        for (const task of saved) {
          for (const item of task.checklistItems ?? [])
            item.canBranch =
              !item.completed && !task.completed && !item.branchedTaskId;
          if (sourceItem)
            Object.assign(task, {
              branchedFromChecklist: {
                taskId: sourceItem.taskId,
                checklistItemId: sourceItem.id,
                title: sourceItem.text,
                description: sourceItem.description ?? null,
              },
            });
        }
        const roles = new Map<string, ProjectRoleContext>(
          memberships.map((m) => [
            m.userId,
            {
              projectRoleId: m.projectRoleId,
              projectRole: m.projectRole ?? null,
            },
          ]),
        );
        const responses = new Map(
          saved.map((task) => [
            task.id,
            this.auth.toTaskSerializer(
              this.members.buildTaskReadModel(task, roles, {
                childCount: 0,
                rollupProgress: task.progress,
              }),
            ),
          ]),
        );
        if (responses.size !== 1)
          throw new Error('Task package response could not be loaded');
        return {
          parentTask: responses.get(parent.id)!,
          checklistTasks: [],
          checklistItems: responses.get(parent.id)!.checklistItems ?? [],
          documentCount: documents.length,
          dependencyCount: dto.dependencies.length,
        };
      });
    } catch (error) {
      // Only newly uploaded objects are ours to delete; referenced source files are never deleted.
      for (const file of attemptedUploads) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.storage.deleteFile(file.bucketName, file.fileName, true);
            break;
          } catch (cleanupError) {
            if (attempt === 2)
              this.logger.error(
                `Task package rollback could not remove ${file.bucketName}/${file.fileName}`,
                cleanupError instanceof Error ? cleanupError.stack : undefined,
              );
          }
        }
      }
      throw error;
    }
  }

  private allDocuments(dto: CreateTaskPackageDto): PackageDocumentDto[] {
    return [
      ...dto.generalStarterDocuments,
      ...dto.checklists.flatMap((t) => [
        ...t.starterDocuments,
        ...t.deliverableDocuments,
      ]),
    ];
  }

  private validateFiles(
    dto: CreateTaskPackageDto,
    files: PackageFile[],
  ): Map<string, PackageFile> {
    const map = new Map<string, PackageFile>();
    for (const file of files) {
      if (map.has(file.fieldname) || !file.buffer?.length)
        throw new BadRequestException('Duplicate or empty file part');
      map.set(file.fieldname, file);
    }
    const keys = this.allDocuments(dto)
      .filter((d) => d.mode === 'UPLOAD')
      .map((d) => d.fileKey!);
    if (
      new Set(keys).size !== keys.length ||
      keys.length !== map.size ||
      keys.some((key) => !map.has(key))
    )
      throw new BadRequestException(
        'Each uploaded file must match exactly one document fileKey',
      );
    return map;
  }

  private async resolveSources(
    tx: EntityManager,
    projectId: string,
    documents: PackageDocumentDto[],
    user: RequestUser,
  ) {
    const sources = new Map<string, TaskDocumentAttachment>();
    for (const input of documents.filter(
      (d) => d.mode === 'FROM_DELIVERABLE',
    )) {
      const source = await tx.findOne(TaskDocumentAttachment, {
        where: { id: input.sourceAttachmentId!, isActive: true },
        relations: [
          'document',
          'document.task',
          'document.task.assignees',
          'document.task.project',
        ],
      });
      const document = source?.document;
      const task = document?.task;
      if (
        !source ||
        !document ||
        !task ||
        task.deletedAt ||
        task.projectId !== projectId ||
        document.type !== TaskDocumentType.DELIVERABLE ||
        (input.sourceTaskId && input.sourceTaskId !== task.id) ||
        (input.sourceDocumentId && input.sourceDocumentId !== document.id)
      )
        throw new BadRequestException(
          'Source deliverable file is unavailable or does not match its owner',
        );
      if (!(await this.auth.canViewTask(task, user)))
        throw new ForbiddenException('Source deliverable file is unavailable');
      sources.set(source.id, source);
    }
    return sources;
  }

  private async createTask(
    tx: EntityManager,
    project: Project,
    actor: User,
    input: PackageTaskDto,
    taskType: ProjectTaskType,
    memberships: Map<string, ProjectMembership>,
    parent: Task | null,
    earliestStartDate?: string | null,
    durationDays = 1,
  ): Promise<Task> {
    await this.auth.assertWipLimit(tx, input.statusId, project.id);
    const rank = await this.ranking.getNextRank(
      tx,
      project.id,
      parent?.id ?? null,
      input.statusId,
    );
    const task = await tx.save(
      tx.create(Task, {
        project,
        projectId: project.id,
        parent,
        parentTaskId: parent?.id ?? null,
        statusId: input.statusId,
        taskTypeId: taskType.id,
        createdByUser: actor,
        createdByUserId: actor.id,
        reporteeUser: actor,
        reporteeUserId: actor.id,
        title: input.title,
        description: input.description ?? null,
        scheduleType: ScheduleType.TASK,
        progress: 0,
        completed: false,
        rank,
        isManuallyScheduled: false,
        deletedAt: null,
      }),
    );
    await this.wbs.reserveExistingTaskCode(tx, task, actor.id);
    await tx.save(
      tx.create(TaskActivitySchedule, {
        taskId: task.id,
        durationDays,
        earliestStartDate: earliestStartDate ?? null,
        plannedStartDate: earliestStartDate ?? null,
        isManuallyScheduled: false,
      }),
    );
    for (const ref of input.assignedMembers) {
      await tx.save(
        tx.create(TaskAssignee, {
          task,
          taskId: task.id,
          user: memberships.get(ref.userId)!.user,
          userId: ref.userId,
          projectRoleId: memberships.get(ref.userId)!.projectRoleId,
        }),
      );
    }
    return task;
  }

  private async createDocuments(
    tx: EntityManager,
    task: Task,
    actor: User,
    inputs: PackageDocumentDto[],
    uploads: Map<string, StoredFile>,
    sources: Map<string, TaskDocumentAttachment>,
    checklistItemId: string | null = null,
  ): Promise<void> {
    for (const input of inputs) {
      const source = input.sourceAttachmentId
        ? sources.get(input.sourceAttachmentId)
        : undefined;
      const document = await tx.save(
        tx.create(TaskDocument, {
          taskId: task.id,
          checklistItemId,
          name: input.name,
          description: input.description?.trim() || null,
          type: input.type,
          createdByUserId: actor.id,
          updatedByUserId: actor.id,
          sourceTaskId: source?.document.taskId ?? null,
          sourceDocumentId: source?.documentId ?? null,
        }),
      );
      const file = input.fileKey ? uploads.get(input.fileKey) : undefined;
      if (file || source)
        await tx.save(
          tx.create(TaskDocumentAttachment, {
            documentId: document.id,
            createdByUserId: actor.id,
            filename: file?.fileName ?? source!.filename,
            bucketName: file?.bucketName ?? source!.bucketName,
            sourceAttachmentId: source?.id ?? null,
            notes: input.attachmentNotes?.trim() || null,
            isActive: true,
          }),
        );
    }
  }
}
