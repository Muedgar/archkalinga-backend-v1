import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { User } from 'src/users/entities';
import { Task, TaskChecklistItem } from '../entities';
import { ProjectStatus } from '../project-config';
import {
  CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK,
  CHECKLIST_DONE_BLOCKED_BY_EMPTY_BRANCH,
  CHECKLIST_STATUS_NOT_FOUND,
  INVALID_TASK_MOVE_TARGET,
} from '../messages';

const RANK_WIDTH = 10;
const RANK_BASE = 36n;
const RANK_STEP = 1024n;

export type DescendantChecklistCompletionState = {
  descendantTaskIds: string[];
  checklistItemCount: number;
  incompleteChecklistItemIds: string[];
  incompleteChecklistItems: Array<{
    id: string;
    taskId: string;
    title: string;
    statusId: string | null;
    branchedTaskId: string | null;
  }>;
};

export type ChecklistTransitionEffects = {
  previousStatusId: string;
  nextStatusId: string;
  previousCompleted: boolean;
  nextCompleted: boolean;
};

export type ChecklistTransitionInput = {
  projectId: string;
  task: Pick<Task, 'id' | 'projectId'>;
  item: TaskChecklistItem;
  targetStatus: ProjectStatus;
  actorUser: User;
  beforeItemId?: string | null;
  afterItemId?: string | null;
  reason?: string | null;
};

export type ChecklistTransitionResult = {
  item: TaskChecklistItem;
  effects: ChecklistTransitionEffects;
  changedItemIds: string[];
  changedTaskIds: string[];
};

type ChecklistRankSibling = Pick<TaskChecklistItem, 'id' | 'rank'>;

@Injectable()
export class TaskChecklistTransitionService {
  async applyChecklistTransition(
    manager: EntityManager,
    input: ChecklistTransitionInput,
  ): Promise<ChecklistTransitionResult> {
    this.assertChecklistInputScope(input);
    this.assertTargetStatusBelongsToProject(input);

    const currentStatus =
      input.item.status ??
      (await manager.findOne(ProjectStatus, {
        where: { id: input.item.statusId, projectId: input.projectId },
      }));
    if (!currentStatus) {
      throw new BadRequestException(CHECKLIST_STATUS_NOT_FOUND);
    }

    const previousStatusId = input.item.statusId;
    const previousCompleted = input.item.completed;
    const enteringDone =
      input.targetStatus.isDone === true && currentStatus.isDone !== true;
    const leavingDone =
      input.targetStatus.isDone !== true &&
      (currentStatus.isDone === true || input.item.completed);

    if (enteringDone && input.item.branchedTaskId) {
      const descendantState = await this.loadDescendantChecklistCompletionState(
        manager,
        input.projectId,
        input.item.branchedTaskId,
      );
      if (descendantState.checklistItemCount === 0) {
        throw this.createEmptyBranchBlockedException(
          input.item.branchedTaskId,
          descendantState,
        );
      }
      if (descendantState.incompleteChecklistItemIds.length > 0) {
        throw this.createDescendantWorkBlockedException(
          input.item.branchedTaskId,
          descendantState,
        );
      }
    }

    input.item.status = input.targetStatus;
    input.item.statusId = input.targetStatus.id;

    if (input.targetStatus.isDone === true) {
      input.item.completed = true;
      input.item.completedAt = input.item.completedAt ?? new Date();
      input.item.completedByUserId =
        input.item.completedByUserId ?? input.actorUser.id;
    } else if (leavingDone || input.item.completed) {
      input.item.completed = false;
      input.item.completedAt = null;
      input.item.completedByUserId = null;
    }

    const shouldReposition =
      input.beforeItemId !== undefined ||
      input.afterItemId !== undefined ||
      previousStatusId !== input.targetStatus.id ||
      !input.item.rank;
    if (shouldReposition) {
      input.item.rank = await this.calculateRankWithinChecklistStatus(
        manager,
        input.projectId,
        input.targetStatus.id,
        input.beforeItemId ?? undefined,
        input.afterItemId ?? undefined,
        input.item.id,
      );
    }

    const saved = await manager.save(TaskChecklistItem, input.item);

    return {
      item: saved,
      effects: {
        previousStatusId,
        nextStatusId: saved.statusId,
        previousCompleted,
        nextCompleted: saved.completed,
      },
      changedItemIds: [saved.id],
      changedTaskIds: [input.task.id],
    };
  }

  async validateChecklistCompletion(
    manager: EntityManager,
    projectId: string,
    item: Pick<TaskChecklistItem, 'id' | 'branchedTaskId'>,
  ): Promise<DescendantChecklistCompletionState | null> {
    if (!item.branchedTaskId) return null;

    const descendantState = await this.loadDescendantChecklistCompletionState(
      manager,
      projectId,
      item.branchedTaskId,
    );
    if (descendantState.checklistItemCount === 0) {
      throw this.createEmptyBranchBlockedException(
        item.branchedTaskId,
        descendantState,
      );
    }
    if (descendantState.incompleteChecklistItemIds.length > 0) {
      throw this.createDescendantWorkBlockedException(
        item.branchedTaskId,
        descendantState,
      );
    }

    return descendantState;
  }

  async loadDescendantChecklistCompletionState(
    manager: EntityManager,
    projectId: string,
    rootTaskId: string,
  ): Promise<DescendantChecklistCompletionState> {
    const rows = await manager.query<
      Array<{
        task_id: string;
        checklist_item_id: string | null;
        checklist_item_task_id: string | null;
        checklist_item_title: string | null;
        checklist_item_completed: boolean | null;
        checklist_item_status_id: string | null;
        checklist_item_branched_task_id: string | null;
      }>
    >(
      `
        WITH RECURSIVE descendant_tasks AS (
          SELECT "id", "parentTaskId"
          FROM "tasks"
          WHERE "id" = $1
            AND "projectId" = $2
            AND "deletedAt" IS NULL

          UNION ALL

          SELECT child."id", child."parentTaskId"
          FROM "tasks" child
          INNER JOIN descendant_tasks parent ON child."parentTaskId" = parent."id"
          WHERE child."projectId" = $2
            AND child."deletedAt" IS NULL
        )
        SELECT
          descendant_tasks."id" AS task_id,
          item."id" AS checklist_item_id,
          item."taskId" AS checklist_item_task_id,
          item."text" AS checklist_item_title,
          item."completed" AS checklist_item_completed,
          item."status_id" AS checklist_item_status_id,
          item."branched_task_id" AS checklist_item_branched_task_id
        FROM descendant_tasks
        LEFT JOIN "task_checklist_items" item
          ON item."taskId" = descendant_tasks."id"
        ORDER BY descendant_tasks."id", item."orderIndex" ASC, item."createdAt" ASC
      `,
      [rootTaskId, projectId],
    );

    const descendantTaskIds = [...new Set(rows.map((row) => row.task_id))];
    const checklistRows = rows.filter((row) => row.checklist_item_id);
    const incompleteRows = checklistRows.filter(
      (row) => row.checklist_item_completed === false,
    );

    return {
      descendantTaskIds,
      checklistItemCount: checklistRows.length,
      incompleteChecklistItemIds: incompleteRows.map(
        (row) => row.checklist_item_id!,
      ),
      incompleteChecklistItems: incompleteRows.map((row) => ({
        id: row.checklist_item_id!,
        taskId: row.checklist_item_task_id!,
        title: row.checklist_item_title ?? '',
        statusId: row.checklist_item_status_id,
        branchedTaskId: row.checklist_item_branched_task_id,
      })),
    };
  }

  private assertTargetStatusBelongsToProject(
    input: Pick<ChecklistTransitionInput, 'projectId' | 'targetStatus'>,
  ): void {
    if (input.targetStatus.projectId !== input.projectId) {
      throw new UnprocessableEntityException({
        message: CHECKLIST_STATUS_NOT_FOUND,
        code: 'CHECKLIST_STATUS_NOT_FOUND',
        details: { statusId: input.targetStatus.id },
      });
    }
  }

  private assertChecklistInputScope(
    input: Pick<ChecklistTransitionInput, 'projectId' | 'task' | 'item'>,
  ): void {
    if (
      input.task.projectId !== input.projectId ||
      input.item.taskId !== input.task.id
    ) {
      throw new BadRequestException(
        'Checklist item does not belong to the provided task/project scope',
      );
    }
  }

  private createDescendantWorkBlockedException(
    branchedTaskId: string,
    state: DescendantChecklistCompletionState,
  ): ConflictException {
    return new ConflictException({
      message: CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK,
      code: 'CHECKLIST_DONE_BLOCKED_BY_DESCENDANT_WORK',
      details: {
        branchedTaskId,
        ...state,
      },
    });
  }

  private createEmptyBranchBlockedException(
    branchedTaskId: string,
    state: DescendantChecklistCompletionState,
  ): ConflictException {
    return new ConflictException({
      message: CHECKLIST_DONE_BLOCKED_BY_EMPTY_BRANCH,
      code: 'CHECKLIST_DONE_BLOCKED_BY_EMPTY_BRANCH',
      details: {
        branchedTaskId,
        ...state,
      },
    });
  }

  private parseRankValue(rank?: string | null): bigint | null {
    if (!rank || !/^[0-9a-z]+$/i.test(rank)) return null;
    let result = 0n;
    for (const char of rank.toLowerCase()) {
      result = result * RANK_BASE + BigInt(parseInt(char, 36));
    }
    return result;
  }

  private formatRankValue(value: bigint): string {
    if (value < 0n) return '0'.repeat(RANK_WIDTH);
    return value.toString(36).padStart(RANK_WIDTH, '0').slice(-RANK_WIDTH);
  }

  private async calculateRankWithinChecklistStatus(
    manager: EntityManager,
    projectId: string,
    statusId: string,
    beforeItemId?: string,
    afterItemId?: string,
    excludeItemId?: string,
  ): Promise<string> {
    const siblings = await this.loadChecklistStatusSiblings(
      manager,
      projectId,
      statusId,
      excludeItemId,
    );
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));

    if (beforeItemId && !siblingIds.has(beforeItemId)) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }
    if (afterItemId && !siblingIds.has(afterItemId)) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }
    if (beforeItemId && afterItemId && beforeItemId === afterItemId) {
      throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
    }

    if (beforeItemId && afterItemId) {
      const beforeIndex = siblings.findIndex(
        (sibling) => sibling.id === beforeItemId,
      );
      const afterIndex = siblings.findIndex(
        (sibling) => sibling.id === afterItemId,
      );
      if (
        beforeIndex === -1 ||
        afterIndex === -1 ||
        afterIndex + 1 !== beforeIndex
      ) {
        throw new BadRequestException(INVALID_TASK_MOVE_TARGET);
      }
    }

    const beforeRank = this.parseRankValue(
      beforeItemId
        ? siblings.find((sibling) => sibling.id === beforeItemId)?.rank
        : null,
    );
    const afterRank = this.parseRankValue(
      afterItemId
        ? siblings.find((sibling) => sibling.id === afterItemId)?.rank
        : null,
    );

    if (beforeRank !== null && afterRank !== null) {
      if (beforeRank - afterRank > 1n) {
        return this.formatRankValue((beforeRank + afterRank) / 2n);
      }
      await this.rebalanceChecklistStatusRanks(manager, projectId, statusId);
      return this.calculateRankWithinChecklistStatus(
        manager,
        projectId,
        statusId,
        beforeItemId,
        afterItemId,
        excludeItemId,
      );
    }

    if (beforeRank !== null) {
      if (beforeRank > 1n) return this.formatRankValue(beforeRank / 2n);
      await this.rebalanceChecklistStatusRanks(manager, projectId, statusId);
      return this.calculateRankWithinChecklistStatus(
        manager,
        projectId,
        statusId,
        beforeItemId,
        afterItemId,
        excludeItemId,
      );
    }

    if (afterRank !== null) {
      return this.formatRankValue(afterRank + RANK_STEP);
    }

    const last = siblings[siblings.length - 1];
    if (!last) return this.formatRankValue(RANK_STEP);

    const lastRank = this.parseRankValue(last.rank) ?? 0n;
    return this.formatRankValue(lastRank + RANK_STEP);
  }

  private async loadChecklistStatusSiblings(
    manager: EntityManager,
    projectId: string,
    statusId: string,
    excludeItemId?: string,
  ): Promise<ChecklistRankSibling[]> {
    const qb = manager
      .createQueryBuilder(TaskChecklistItem, 'item')
      .innerJoin(Task, 'task', 'task.id = item.taskId')
      .where('task.projectId = :projectId', { projectId })
      .andWhere('task.deletedAt IS NULL')
      .andWhere('item.statusId = :statusId', { statusId })
      .orderBy('item.rank', 'ASC', 'NULLS LAST')
      .addOrderBy('item.createdAt', 'ASC')
      .select(['item.id', 'item.rank']);

    if (excludeItemId) {
      qb.andWhere('item.id != :excludeItemId', { excludeItemId });
    }

    return qb.getMany();
  }

  private async rebalanceChecklistStatusRanks(
    manager: EntityManager,
    projectId: string,
    statusId: string,
  ): Promise<void> {
    const siblings = await this.loadChecklistStatusSiblings(
      manager,
      projectId,
      statusId,
    );

    let current = RANK_STEP;
    for (const sibling of siblings) {
      const nextRank = this.formatRankValue(current);
      if (sibling.rank !== nextRank) {
        await manager.update(TaskChecklistItem, sibling.id, {
          rank: nextRank,
        });
      }
      current += RANK_STEP;
    }
  }
}
