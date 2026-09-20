import { User } from 'src/users/entities';
import { EntityManager, IsNull } from 'typeorm';
import {
  Task,
  TaskChecklistItem,
  ChecklistSubmission,
  SubmissionOutcome,
} from '../entities';
import {
  ProjectStatus,
  CanonicalStage as S,
} from '../project-config/project-status.entity';
import { ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { STAGES } from './workflow-domain';
export async function auditWorkflow(tx: EntityManager, projectId: string) {
  const tasks = await tx.find(Task, {
    where: { projectId, deletedAt: IsNull() },
  });
  const statuses = await tx.find(ProjectStatus, { where: { projectId } });
  const members = await tx.find(ProjectMembership, {
    where: { projectId, status: MembershipStatus.ACTIVE },
  });
  const items = await tx
    .createQueryBuilder(TaskChecklistItem, 'i')
    .innerJoin(Task, 't', 't.id = i.taskId')
    .where('t.projectId = :projectId', { projectId })
    .andWhere('t.deletedAt IS NULL')
    .getMany();
  const issues: { code: string; id?: string; details?: unknown }[] = [];
  for (const stage of STAGES)
    if (
      statuses.filter((s) => s.canonicalStage === stage && s.isActive)
        .length !== 1
    )
      issues.push({
        code: 'CANONICAL_STATUS_MAPPING_REQUIRED',
        details: stage,
      });
  for (const status of statuses)
    if (status.isDone !== (status.canonicalStage === S.DONE))
      issues.push({ code: 'STATUS_SEMANTICS_CONFLICT', id: status.id });
  for (const task of tasks) {
    const owner = task.reporteeUserId
      ? await tx.findOne(User, { where: { id: task.reporteeUserId } })
      : null;
    if (!owner?.status)
      issues.push({ code: 'REPORTEE_ACCOUNT_REPAIR_REQUIRED', id: task.id });
    if (
      task.completed !==
      (statuses.find((s) => s.id === task.statusId)?.canonicalStage === S.DONE)
    )
      issues.push({ code: 'TASK_COMPLETION_STATUS_CONFLICT', id: task.id });
    if (
      !task.reporteeUserId ||
      !members.some((m) => m.userId === task.reporteeUserId)
    )
      issues.push({ code: 'REPORTEE_REPAIR_REQUIRED', id: task.id });
    if (
      task.completed &&
      (items.some((i) => i.taskId === task.id && !i.completed) ||
        tasks.some((t) => t.parentTaskId === task.id && !t.completed))
    )
      issues.push({ code: 'COMPLETED_TASK_HAS_OPEN_WORK', id: task.id });
    const seen = new Set([task.id]);
    let parentId = task.parentTaskId;
    while (parentId) {
      if (seen.has(parentId)) {
        issues.push({ code: 'HIERARCHY_CYCLE', id: task.id });
        break;
      }
      seen.add(parentId);
      const parent = tasks.find((t) => t.id === parentId);
      if (!parent) {
        issues.push({ code: 'MISSING_PARENT', id: task.id });
        break;
      }
      parentId = parent.parentTaskId;
    }
  }
  for (const item of items) {
    const status = statuses.find((s) => s.id === item.statusId);
    if (!status || item.completed !== (status.canonicalStage === S.DONE))
      issues.push({ code: 'CHECKLIST_STATUS_CONFLICT', id: item.id });
    if (
      item.effectiveStage === String(S.IN_REVIEW) &&
      !item.branchedTaskId &&
      !(await tx.exists(ChecklistSubmission, {
        where: {
          checklistItemId: item.id,
          outcome: SubmissionOutcome.SUBMITTED,
        },
      }))
    )
      issues.push({ code: 'LEGACY_REVIEW_REQUIRES_RESUBMISSION', id: item.id });
    if (
      item.branchedTaskId &&
      !tasks.some(
        (t) => t.id === item.branchedTaskId && t.parentTaskId === item.taskId,
      )
    )
      issues.push({ code: 'INVALID_BRANCH_LINK', id: item.id });
  }
  const ambiguous = await tx.query<{ id: string }[]>(
    `SELECT a.entity_id AS id FROM workflow_migration_audit a
    JOIN project_statuses s ON s.id=(a.snapshot->>'status_id')::uuid
    WHERE a.project_id=$1 AND a.operation='CHECKLIST_CLASSIFICATION' AND s.canonical_stage IS NULL
    AND NOT (a.snapshot->>'completed')::boolean
    AND NOT EXISTS(SELECT 1 FROM workflow_migration_audit r WHERE r.entity_id=a.entity_id AND r.operation='CUSTOM_STAGE_REPAIRED')`,
    [projectId],
  );
  for (const row of ambiguous)
    issues.push({ code: 'LEGACY_CUSTOM_STAGE_REQUIRES_REPAIR', id: row.id });
  return {
    projectId,
    taskCount: tasks.length,
    checklistCount: items.length,
    issues,
  };
}
