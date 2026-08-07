import { Brackets, SelectQueryBuilder } from 'typeorm';
import {
  ChangeRequest,
  ChangeRequestReviewStatus,
  ChangeRequestStatus,
} from '../entities';

type ChangeRequestNeedsMyAttentionAliases = {
  changeRequest: string;
  review: string;
  task: string;
  taskAssignee: string;
};

const DEFAULT_NEEDS_MY_ATTENTION_ALIASES: ChangeRequestNeedsMyAttentionAliases =
  {
    changeRequest: 'changeRequest',
    review: 'review',
    task: 'task',
    taskAssignee: 'taskAssignee',
  };

export function applyChangeRequestNeedsMyAttentionScope(
  qb: SelectQueryBuilder<ChangeRequest>,
  userId: string,
  aliases: Partial<ChangeRequestNeedsMyAttentionAliases> = {},
): void {
  const resolvedAliases = {
    ...DEFAULT_NEEDS_MY_ATTENTION_ALIASES,
    ...aliases,
  };

  qb.andWhere(
    new Brackets((attentionQb) => {
      attentionQb
        .where(
          `${resolvedAliases.review}.reviewerUserId = :attentionUserId AND ${resolvedAliases.review}.status = :pendingReviewStatus`,
          {
            attentionUserId: userId,
            pendingReviewStatus: ChangeRequestReviewStatus.PENDING,
          },
        )
        .orWhere(
          `${resolvedAliases.changeRequest}.status = :returnedForRevisionStatus AND (${resolvedAliases.changeRequest}.createdByUserId = :attentionUserId OR ${resolvedAliases.task}.reporteeUserId = :attentionUserId OR ${resolvedAliases.taskAssignee}.userId = :attentionUserId)`,
          {
            attentionUserId: userId,
            returnedForRevisionStatus:
              ChangeRequestStatus.RETURNED_FOR_REVISION,
          },
        )
        .orWhere(
          `${resolvedAliases.changeRequest}.status = :escalatedStatus AND ${resolvedAliases.changeRequest}.escalatedToUserId = :attentionUserId`,
          {
            attentionUserId: userId,
            escalatedStatus: ChangeRequestStatus.ESCALATED,
          },
        );
    }),
  );
}
