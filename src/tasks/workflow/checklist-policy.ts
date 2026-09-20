import { ForbiddenException } from '@nestjs/common';
import {
  CanonicalStage as Stage,
  ProjectStatus,
} from '../project-config/project-status.entity';
import { Task, TaskChecklistItem } from '../entities';
import { conflict } from './workflow-domain';
export type WorkflowIntent =
  | 'MOVE'
  | 'SUBMIT'
  | 'ACCEPT'
  | 'REJECT'
  | 'WITHDRAW';
export function relationships(
  task: Pick<Task, 'reporteeUserId' | 'assignees'>,
  actorId: string,
) {
  return {
    assignee: (task.assignees ?? []).some((a) => a.userId === actorId),
    reviewer: task.reporteeUserId === actorId,
  };
}
export function authorizeTransition(
  item: TaskChecklistItem,
  current: ProjectStatus,
  target: ProjectStatus,
  roles: { assignee: boolean; reviewer: boolean },
  requested?: WorkflowIntent,
): WorkflowIntent {
  if (item.branchedTaskId) conflict('BRANCHED_CHECKLIST_STATUS_IS_DERIVED');
  if (!target.isActive) conflict('CHECKLIST_STATUS_INACTIVE');
  if (item.completed || current.canonicalStage === Stage.DONE)
    conflict('CHECKLIST_DONE_IS_TERMINAL');
  const review = current.canonicalStage === Stage.IN_REVIEW;
  let intent: WorkflowIntent = requested ?? 'MOVE';
  if (!review && target.canonicalStage === Stage.DONE)
    conflict('CHECKLIST_REVIEW_REQUIRED');
  if (target.id !== current.id) {
    if (!review && target.canonicalStage === Stage.IN_REVIEW) intent = 'SUBMIT';
    else if (review && target.canonicalStage === Stage.DONE) intent = 'ACCEPT';
    else if (review) {
      if (!requested || requested === 'MOVE') {
        if (roles.assignee && roles.reviewer)
          conflict('CHECKLIST_RETURN_INTENT_REQUIRED');
        intent = roles.reviewer ? 'REJECT' : 'WITHDRAW';
      }
    }
  }
  if (requested && requested !== 'MOVE' && requested !== intent)
    conflict('INVALID_WORKFLOW_INTENT');
  if (intent === 'SUBMIT' && review) conflict('CHECKLIST_ALREADY_SUBMITTED');
  const valid =
    intent === 'MOVE'
      ? target.id === current.id ||
        (!review &&
          target.canonicalStage !== Stage.IN_REVIEW &&
          target.canonicalStage !== Stage.DONE)
      : intent === 'SUBMIT'
        ? !review && target.canonicalStage === Stage.IN_REVIEW
        : intent === 'ACCEPT'
          ? review && target.canonicalStage === Stage.DONE
          : review &&
            target.canonicalStage !== Stage.IN_REVIEW &&
            target.canonicalStage !== Stage.DONE;
  if (!valid) conflict('INVALID_WORKFLOW_INTENT');
  const allowed =
    intent === 'ACCEPT' || intent === 'REJECT'
      ? roles.reviewer
      : roles.assignee;
  if (!allowed)
    throw new ForbiddenException({ code: 'CHECKLIST_TRANSITION_FORBIDDEN' });
  return intent;
}
export function checklistCapabilities(
  item: TaskChecklistItem,
  current: ProjectStatus,
  statuses: ProjectStatus[],
  task: Task,
  actorId: string,
) {
  const roles = relationships(task, actorId);
  const live =
    !item.completed &&
    !item.branchedTaskId &&
    !task.completed &&
    !task.deletedAt &&
    !task.supersededByTaskId;
  const review = current.canonicalStage === Stage.IN_REVIEW;
  const allowedTargetStatusIds = live
    ? statuses
        .filter((s) => {
          try {
            authorizeTransition(
              item,
              current,
              s,
              roles,
              review &&
                roles.assignee &&
                roles.reviewer &&
                s.canonicalStage !== Stage.DONE &&
                s.id !== current.id
                ? 'WITHDRAW'
                : undefined,
            );
            return true;
          } catch {
            return false;
          }
        })
        .map((s) => s.id)
    : [];
  return {
    allowedTargetStatusIds,
    canSubmit: live && !review && roles.assignee,
    canWithdraw: live && review && roles.assignee,
    canReview: live && review && roles.reviewer,
    canEditSubmissionNotes: live && review && roles.reviewer,
    canUploadDeliverables: live && roles.assignee,
  };
}
