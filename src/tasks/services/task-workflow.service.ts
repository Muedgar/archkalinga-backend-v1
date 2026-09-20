import { TaskProgressService } from './task-progress.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, LessThan } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { User } from 'src/users/entities';
import {
  ChecklistSubmission,
  ChecklistSubmissionEvidence,
  ChecklistReviewNote,
  ChecklistWorkflowReceipt,
  SubmissionOutcome,
  TaskWorkflowReceipt,
  Task,
  TaskChecklistItem,
  TaskDocument,
  TaskDocumentAttachment,
  TaskDocumentType,
  ChecklistDependency,
  TaskActionType,
} from '../entities';
import {
  CanonicalStage as Stage,
  ProjectStatus,
} from '../project-config/project-status.entity';
import { TaskAuthService } from './task-auth.service';
import { TaskActivityService } from './task-activity.service';
import { TaskChecklistTransitionService } from './task-checklist-transition.service';
import {
  activeStage,
  canonicalStatuses,
  conflict,
  lockWorkflow,
  rollupStatuses,
} from '../workflow/workflow-domain';
import {
  authorizeTransition,
  checklistCapabilities,
  relationships,
  WorkflowIntent,
} from '../workflow/checklist-policy';
import {
  ChecklistReviewNoteDto,
  SubmissionHistoryDto,
  WorkflowRevisionDto,
} from '../dtos/checklist-workflow.dto';

export interface WorkflowCommand {
  expectedRevision: number;
  idempotencyKey: string;
  statusId?: string;
  intent?: WorkflowIntent;
  submissionId?: string;
  source?: 'drag' | 'submit';
  reviewNote?: string;
  submissionNote?: string;
  beforeItemId?: string;
  afterItemId?: string;
}
@Injectable()
export class TaskWorkflowService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: TaskAuthService,
    private readonly activity: TaskActivityService,
    private readonly transitions: TaskChecklistTransitionService,
  ) {}

  private async load(
    tx: EntityManager,
    projectId: string,
    taskId: string,
    itemId: string,
    actor: RequestUser,
  ) {
    const member = await tx.findOne(ProjectMembership, {
      where: { projectId, userId: actor.id, status: MembershipStatus.ACTIVE },
    });
    if (!member)
      throw new ForbiddenException('Active project membership required');
    const task = await tx.findOne(Task, {
      where: { id: taskId, projectId, deletedAt: IsNull() },
      relations: ['assignees'],
    });
    if (!task || !(await this.auth.canViewTask(task, actor)))
      throw new NotFoundException('Task not found');
    const item = await tx.findOne(TaskChecklistItem, {
      where: { id: itemId, taskId },
    });
    if (!item) throw new NotFoundException('Checklist not found');
    return { task, item };
  }
  private hash(command: Record<string, unknown>) {
    return createHash('sha256')
      .update(
        JSON.stringify(
          Object.keys(command)
            .sort()
            .map((k) => [k, command[k]]),
        ),
      )
      .digest('hex');
  }
  private async receipt(
    tx: EntityManager,
    projectId: string,
    itemId: string,
    actorId: string,
    key: string,
    hash: string,
  ) {
    const receipt = await tx.findOne(ChecklistWorkflowReceipt, {
      where: {
        projectId,
        checklistItemId: itemId,
        actorUserId: actorId,
        idempotencyKey: key,
      },
    });
    if (receipt && receipt.commandHash !== hash)
      conflict('IDEMPOTENCY_KEY_REUSED');
    return receipt;
  }
  private async replay(
    tx: EntityManager,
    saved: Record<string, unknown>,
    actor: RequestUser,
  ) {
    const response = structuredClone(saved) as Record<string, unknown> & {
      changedTasks?: { id: string }[];
      changedChecklistItems?: { id: string }[];
    };
    const visible = new Set<string>();
    for (const projection of response.changedTasks ?? []) {
      const task = await tx.findOne(Task, {
        where: { id: projection.id, deletedAt: IsNull() },
        relations: ['assignees'],
      });
      if (task && (await this.auth.canViewTask(task, actor)))
        visible.add(task.id);
    }
    response.changedTasks = (response.changedTasks ?? []).filter((t) =>
      visible.has(t.id),
    );
    response.changedTaskIds = [...visible];
    const items = [] as { id: string }[];
    for (const projection of response.changedChecklistItems ?? []) {
      const item = await tx.findOne(TaskChecklistItem, {
        where: { id: projection.id },
      });
      if (item && visible.has(item.taskId)) items.push(projection);
    }
    response.changedChecklistItems = items;
    response.changedItemIds = items.map((i) => i.id);
    return { ...response, replayed: true };
  }
  async execute(
    projectId: string,
    taskId: string,
    itemId: string,
    actor: RequestUser,
    command: WorkflowCommand,
  ) {
    if (
      !Number.isInteger(command.expectedRevision) ||
      command.expectedRevision < 1 ||
      !command.idempotencyKey?.trim() ||
      command.idempotencyKey.length > 128
    )
      throw new BadRequestException(
        'expectedRevision and idempotencyKey are required',
      );
    return this.db.transaction(async (tx) => {
      await lockWorkflow(tx, projectId);
      const { task, item } = await this.load(
        tx,
        projectId,
        taskId,
        itemId,
        actor,
      );
      const canonical = await canonicalStatuses(tx, projectId);
      const current = await tx.findOneOrFail(ProjectStatus, {
        where: { id: item.statusId, projectId },
      });
      const targetId =
        command.intent === 'SUBMIT'
          ? canonical.get(Stage.IN_REVIEW)!.id
          : command.intent === 'ACCEPT'
            ? canonical.get(Stage.DONE)!.id
            : command.statusId;
      if (!targetId)
        throw new BadRequestException('Return/withdrawal requires statusId');
      const target = await tx.findOne(ProjectStatus, {
        where: { id: targetId, projectId, isActive: true },
      });
      if (!target) throw new BadRequestException('Invalid project status');
      // Stable normalized command excludes transport source, allowing drag/submit retry equivalence.
      const hash = this.hash({
        statusId: targetId,
        intent:
          command.intent ??
          (target.canonicalStage === Stage.IN_REVIEW
            ? 'SUBMIT'
            : target.canonicalStage === Stage.DONE
              ? 'ACCEPT'
              : 'MOVE'),
        expectedRevision: command.expectedRevision,
        submissionId: command.submissionId ?? null,
        reviewNote: command.reviewNote ?? null,
        submissionNote: command.submissionNote ?? null,
        beforeItemId: command.beforeItemId ?? null,
        afterItemId: command.afterItemId ?? null,
      });
      const prior = await this.receipt(
        tx,
        projectId,
        itemId,
        actor.id,
        command.idempotencyKey,
        hash,
      );
      if (prior) return this.replay(tx, prior.response, actor);
      if (item.version !== command.expectedRevision)
        conflict('STALE_WORKFLOW_REVISION', { revision: item.version });
      if (task.supersededByTaskId || task.completed)
        conflict('TASK_WORKFLOW_CLOSED');
      const intent = authorizeTransition(
        item,
        current,
        target,
        relationships(task, actor.id),
        command.intent,
      );
      let submission = await tx.findOne(ChecklistSubmission, {
        where: {
          checklistItemId: itemId,
          outcome: SubmissionOutcome.SUBMITTED,
        },
      });
      if (command.submissionId && submission?.id !== command.submissionId)
        conflict('SUBMISSION_IS_NOT_ACTIVE');
      if (intent === 'SUBMIT') {
        if (submission) conflict('CHECKLIST_ALREADY_SUBMITTED');
        const last = await tx.findOne(ChecklistSubmission, {
          where: { checklistItemId: itemId },
          order: { attemptNumber: 'DESC' },
        });
        submission = await tx.save(
          ChecklistSubmission,
          tx.create(ChecklistSubmission, {
            projectId,
            taskId,
            checklistItemId: itemId,
            attemptNumber: (last?.attemptNumber ?? 0) + 1,
            submittedByUserId: actor.id,
            submittedAt: new Date(),
            source: command.source ?? 'drag',
            outcome: SubmissionOutcome.SUBMITTED,
            outcomeByUserId: null,
            outcomeAt: null,
            submissionNote: command.submissionNote ?? null,
          }),
        );
        const documents = await tx.find(TaskDocument, {
          where: {
            taskId,
            checklistItemId: itemId,
            type: TaskDocumentType.DELIVERABLE,
            deletedAt: IsNull(),
          },
        });
        for (const doc of documents) {
          const attachments = await tx.find(TaskDocumentAttachment, {
            where: { documentId: doc.id, isActive: true, deletedAt: IsNull() },
          });
          for (const file of attachments)
            await tx.save(
              ChecklistSubmissionEvidence,
              tx.create(ChecklistSubmissionEvidence, {
                submissionId: submission.id,
                documentId: doc.id,
                attachmentId: file.id,
                snapshot: {
                  documentName: doc.name,
                  description: doc.description,
                  documentVersion: doc.version,
                  originalName: file.originalName ?? file.filename,
                  mimeType: file.mimeType,
                  sizeBytes: file.sizeBytes,
                  notes: file.notes,
                  uploadedByUserId: file.createdByUserId,
                  uploadedAt: file.createdAt,
                  attachmentVersion: file.version,
                },
              }),
            );
        }
      } else if (['ACCEPT', 'REJECT', 'WITHDRAW'].includes(intent)) {
        if (!submission) conflict('LEGACY_REVIEW_REQUIRES_RESUBMISSION');
        submission.outcome =
          intent === 'ACCEPT'
            ? SubmissionOutcome.ACCEPTED
            : intent === 'REJECT'
              ? SubmissionOutcome.REJECTED
              : SubmissionOutcome.WITHDRAWN;
        submission.outcomeByUserId = actor.id;
        submission.outcomeAt = new Date();
        await tx.save(submission);
      }
      if (
        command.reviewNote &&
        submission &&
        (intent === 'ACCEPT' || intent === 'REJECT')
      )
        await tx.save(
          ChecklistReviewNote,
          tx.create(ChecklistReviewNote, {
            submissionId: submission.id,
            noteId: randomUUID(),
            revision: 1,
            authorUserId: actor.id,
            text: command.reviewNote,
          }),
        );
      item.effectiveStage = activeStage(
        item.effectiveStage,
        target.canonicalStage,
      );
      const user = await tx.findOneOrFail(User, { where: { id: actor.id } });
      const result = await this.transitions.persistAuthorizedTransition(tx, {
        projectId,
        task,
        item,
        targetStatus: target,
        actorUser: user,
        beforeItemId: command.beforeItemId,
        afterItemId: command.afterItemId,
      });
      const changed = await rollupStatuses(tx, projectId);
      await new TaskProgressService(
        tx.getRepository(Task),
      ).recalculateProjectTaskProgress(tx, projectId);
      // Numerical progress can change without advancing the canonical stage.
      const affectedIds = new Set(changed.changedTasks.map((t) => t.id));
      let ancestor: Task | null = task;
      while (ancestor) {
        affectedIds.add(ancestor.id);
        ancestor = ancestor.parentTaskId
          ? await tx.findOne(Task, {
              where: { id: ancestor.parentTaskId, projectId },
            })
          : null;
      }
      changed.changedTasks = await tx.find(Task, {
        where: { id: In([...affectedIds]) },
      });
      await this.activity.log(
        tx,
        task,
        user,
        TaskActionType.CHECKLIST_UPDATED,
        {
          operation: 'checklist_workflow',
          intent,
          checklistItemId: itemId,
          submissionId: submission?.id ?? null,
          effects: result.effects,
        },
      );
      const statuses = await tx.find(ProjectStatus, {
        where: { projectId, isActive: true },
      });
      const visibleTasks = [] as Task[];
      for (const t of changed.changedTasks) {
        t.assignees = (
          await tx.findOneOrFail(Task, {
            where: { id: t.id },
            relations: ['assignees'],
          })
        ).assignees;
        if (await this.auth.canViewTask(t, actor)) visibleTasks.push(t);
      }
      const visibleItems: TaskChecklistItem[] = [];
      for (const i of changed.changedItems)
        if (i.taskId === taskId || visibleTasks.some((t) => t.id === i.taskId))
          visibleItems.push(i);
      const response = {
        item: { ...result.item, revision: result.item.version },
        effects: result.effects,
        submissionEffect: submission
          ? {
              id: submission.id,
              attemptNumber: submission.attemptNumber,
              outcome: submission.outcome,
            }
          : null,
        changedTasks: visibleTasks.map((t) => ({
          id: t.id,
          statusId: t.statusId,
          completed: t.completed,
          progress: t.progress,
          revision: t.version,
        })),
        changedChecklistItems: [result.item, ...visibleItems].map((i) => ({
          id: i.id,
          statusId: i.statusId,
          completed: i.completed,
          revision: i.version,
        })),
        changedTaskIds: visibleTasks.map((t) => t.id),
        changedItemIds: [itemId, ...visibleItems.map((i) => i.id)],
        capabilities: checklistCapabilities(
          result.item,
          target,
          statuses,
          task,
          actor.id,
        ),
        warnings: await this.warnings(tx, item),
        replayed: false,
      };
      await tx.save(
        ChecklistWorkflowReceipt,
        tx.create(ChecklistWorkflowReceipt, {
          projectId,
          checklistItemId: itemId,
          actorUserId: actor.id,
          idempotencyKey: command.idempotencyKey,
          commandHash: hash,
          response: JSON.parse(JSON.stringify(response)) as Record<
            string,
            unknown
          >,
        }),
      );
      return response;
    });
  }
  async history(
    projectId: string,
    taskId: string,
    itemId: string,
    actor: RequestUser,
    query: SubmissionHistoryDto,
  ) {
    const tx = this.db.manager;
    await this.load(tx, projectId, taskId, itemId, actor);
    const limit = query.limit ?? 25;
    const attempts = await tx.find(ChecklistSubmission, {
      where: {
        checklistItemId: itemId,
        ...(query.beforeAttempt
          ? { attemptNumber: LessThan(query.beforeAttempt) }
          : {}),
      },
      order: { attemptNumber: 'DESC' },
      take: limit + 1,
    });
    const items = await Promise.all(
      attempts.slice(0, limit).map(async (attempt) => {
        const evidence = await tx.find(ChecklistSubmissionEvidence, {
          where: { submissionId: attempt.id },
        });
        const notes = await tx.find(ChecklistReviewNote, {
          where: { submissionId: attempt.id },
          order: { createdAt: 'ASC', revision: 'ASC' },
        });
        return {
          ...attempt,
          notes,
          evidence: await Promise.all(
            evidence.map(async (e) => {
              const file = await tx.findOne(TaskDocumentAttachment, {
                where: { id: e.attachmentId },
              });
              const doc = await tx.findOne(TaskDocument, {
                where: { id: e.documentId },
              });
              return {
                ...e,
                fileAvailable:
                  !!file && !!doc && !file.deletedAt && !doc.deletedAt,
                deletedAt: file?.deletedAt ?? doc?.deletedAt ?? null,
              };
            }),
          ),
        };
      }),
    );
    return {
      items,
      nextBeforeAttempt:
        attempts.length > limit ? items[items.length - 1].attemptNumber : null,
    };
  }
  async notes(
    projectId: string,
    taskId: string,
    itemId: string,
    submissionId: string,
    actor: RequestUser,
    dto: ChecklistReviewNoteDto,
  ) {
    return this.db.transaction(async (tx) => {
      await lockWorkflow(tx, projectId);
      const { task, item } = await this.load(
        tx,
        projectId,
        taskId,
        itemId,
        actor,
      );
      const hash = this.hash({
        operation: 'review-note',
        submissionId,
        ...dto,
      });
      const prior = await this.receipt(
        tx,
        projectId,
        itemId,
        actor.id,
        dto.idempotencyKey,
        hash,
      );
      if (prior) return { ...prior.response, replayed: true };
      if (task.reporteeUserId !== actor.id)
        throw new ForbiddenException(
          'Only current reportee can edit review notes',
        );
      if (item.version !== dto.expectedRevision)
        conflict('STALE_WORKFLOW_REVISION');
      const submission = await tx.findOne(ChecklistSubmission, {
        where: {
          id: submissionId,
          checklistItemId: itemId,
          outcome: SubmissionOutcome.SUBMITTED,
        },
      });
      if (!submission || item.completed || item.branchedTaskId)
        conflict('SUBMISSION_IS_NOT_ACTIVE');
      const priorNote = dto.noteId
        ? await tx.findOne(ChecklistReviewNote, {
            where: { noteId: dto.noteId, submissionId },
            order: { revision: 'DESC' },
          })
        : null;
      if (
        dto.noteId &&
        (!priorNote || priorNote.revision !== dto.expectedNoteRevision)
      )
        conflict('STALE_NOTE_REVISION');
      const note = await tx.save(
        ChecklistReviewNote,
        tx.create(ChecklistReviewNote, {
          submissionId,
          noteId: dto.noteId ?? randomUUID(),
          revision: (priorNote?.revision ?? 0) + 1,
          authorUserId: actor.id,
          text: dto.text,
        }),
      );
      await tx.increment(TaskChecklistItem, { id: item.id }, 'version', 1);
      const response = { note, revision: item.version + 1, replayed: false };
      await tx.save(
        ChecklistWorkflowReceipt,
        tx.create(ChecklistWorkflowReceipt, {
          projectId,
          checklistItemId: itemId,
          actorUserId: actor.id,
          idempotencyKey: dto.idempotencyKey,
          commandHash: hash,
          response: JSON.parse(JSON.stringify(response)) as Record<
            string,
            unknown
          >,
        }),
      );
      return response;
    });
  }
  async removeReportee(
    projectId: string,
    taskId: string,
    actor: RequestUser,
    dto: WorkflowRevisionDto,
  ) {
    return this.db.transaction(async (tx) => {
      await lockWorkflow(tx, projectId);
      await this.auth.verifyProjectPermission(projectId, actor, 'view');
      const task = await tx.findOne(Task, {
        where: { id: taskId, projectId, deletedAt: IsNull() },
        relations: ['assignees'],
      });
      if (!task || !(await this.auth.canViewTask(task, actor)))
        throw new NotFoundException('Task not found');
      if (!task.parentTaskId) conflict('ROOT_REPORTEE_CANNOT_BE_REMOVED');
      const hash = this.hash({ operation: 'remove-reportee', ...dto });
      const receipt = await tx.findOne(TaskWorkflowReceipt, {
        where: {
          taskId,
          actorUserId: actor.id,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (receipt) {
        if (receipt.commandHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED');
        return { ...receipt.response, replayed: true };
      }
      await this.auth.assertTaskOwnedChecklistManagementAllowed({
        projectId,
        taskId: task.parentTaskId,
        requestUser: actor,
      });
      if (task.version !== dto.expectedRevision)
        conflict('STALE_WORKFLOW_REVISION');
      const parent = await tx.findOneOrFail(Task, {
        where: { id: task.parentTaskId, projectId, deletedAt: IsNull() },
      });
      if (
        !parent.reporteeUserId ||
        !(await tx.exists(ProjectMembership, {
          where: {
            projectId,
            userId: parent.reporteeUserId,
            status: MembershipStatus.ACTIVE,
          },
        }))
      )
        conflict('PARENT_REPORTEE_REQUIRES_REPAIR');
      const previousReporteeUserId = task.reporteeUserId;
      task.reporteeUserId = parent.reporteeUserId;
      task.reporteeUser = await tx.findOneOrFail(User, {
        where: { id: parent.reporteeUserId },
      });
      await tx.save(task);
      await this.activity.log(
        tx,
        task,
        await tx.findOneOrFail(User, { where: { id: actor.id } }),
        TaskActionType.TASK_UPDATED,
        {
          operation: 'child_reportee_removed',
          previousReporteeUserId,
          reporteeUserId: task.reporteeUserId,
          parentTaskId: parent.id,
        },
      );
      const response = {
        taskId,
        reporteeUserId: task.reporteeUserId,
        revision: task.version,
        previousReporteeUserId,
        replayed: false,
      };
      await tx.save(
        TaskWorkflowReceipt,
        tx.create(TaskWorkflowReceipt, {
          taskId,
          actorUserId: actor.id,
          idempotencyKey: dto.idempotencyKey,
          commandHash: hash,
          response,
        }),
      );
      return response;
    });
  }

  async warnings(tx: EntityManager, item: TaskChecklistItem) {
    const warnings: { code: string; details?: unknown }[] = [];
    const today = new Date().toISOString().slice(0, 10);
    if ((item.earliestStartDate ?? item.plannedStartDate ?? '') > today)
      warnings.push({ code: 'BEFORE_PLANNED_START' });
    const dependencies = await tx.find(ChecklistDependency, {
      where: { checklistItemId: item.id },
    });
    for (const d of dependencies) {
      const predecessor = await tx.findOne(TaskChecklistItem, {
        where: { id: d.dependsOnChecklistItemId },
      });
      if (predecessor && !predecessor.completed)
        warnings.push({
          code: 'PREDECESSOR_INCOMPLETE',
          details: { advisory: true },
        });
    }
    return warnings;
  }
}
