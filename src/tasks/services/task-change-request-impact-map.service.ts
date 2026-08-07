import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { ProjectMembership } from 'src/projects/entities';
import { ChangeRequestImpactMapQueryDto } from '../dtos';
import {
  ChangeRequest,
  ChangeRequestImpactType,
  ChangeRequestPriority,
  ChangeRequestStatus,
} from '../entities';
import { TaskListItemSerializer } from '../serializers';
import { applyChangeRequestNeedsMyAttentionScope } from './change-request-query-scopes';
import { TaskQueryService, TaskTreeNode } from './task-query.service';

const OPEN_CHANGE_REQUEST_STATUSES = new Set<ChangeRequestStatus>([
  ChangeRequestStatus.NEW,
  ChangeRequestStatus.UNDER_REVIEW,
  ChangeRequestStatus.ESCALATED,
  ChangeRequestStatus.RETURNED_FOR_REVISION,
]);

const FINAL_CHANGE_REQUEST_STATUSES = new Set<ChangeRequestStatus>([
  ChangeRequestStatus.APPROVED,
  ChangeRequestStatus.REJECTED,
  ChangeRequestStatus.CANCELLED,
]);

type ChangeRequestBucket<T extends string> = Partial<Record<T, number>>;

export type ChangeRequestImpactIntensity =
  | 'none'
  | 'low'
  | 'medium'
  | 'high';

export type ChangeRequestImpactMapTaskSummary = {
  taskId: string;
  total: number;
  open: number;
  final: number;
  escalated: number;
  critical: number;
  needsMyAttention: number;
  latestStatus: ChangeRequestStatus | null;
  latestUpdatedAt: string | null;
  intensity: ChangeRequestImpactIntensity;
  byStatus: ChangeRequestBucket<ChangeRequestStatus>;
  byImpactType: ChangeRequestBucket<ChangeRequestImpactType>;
  byPriority: ChangeRequestBucket<ChangeRequestPriority>;
};

export type ChangeRequestImpactMapItem = {
  id: string;
  taskId: string;
  title: string;
  status: ChangeRequestStatus;
  impactType: ChangeRequestImpactType | null;
  priority: ChangeRequestPriority | null;
  createdById: string;
  escalatedToUserId: string | null;
  updatedAt: string;
};

export type ChangeRequestImpactMapResponse = {
  meta: {
    projectId: string;
    rootTaskId: string;
    depth: number | 'all';
    limit: number;
    truncated: boolean;
    collapsedMode: string;
    filters: {
      status: ChangeRequestStatus | null;
      impactType: ChangeRequestImpactType | null;
      priority: ChangeRequestPriority | null;
      createdByUserId: string | null;
      escalatedToUserId: string | null;
      reviewerUserId: string | null;
      needsMyAttention: boolean | null;
      includeItems: boolean;
      itemLimitPerTask: number;
    };
    generatedAt: string;
  };
  summary: {
    affectedTaskCount: number;
    total: number;
    open: number;
    final: number;
    escalated: number;
    needsMyAttention: number;
    critical: number;
    byStatus: ChangeRequestBucket<ChangeRequestStatus>;
    byImpactType: ChangeRequestBucket<ChangeRequestImpactType>;
    byPriority: ChangeRequestBucket<ChangeRequestPriority>;
  };
  data: {
    taskSummaries: Record<string, ChangeRequestImpactMapTaskSummary>;
    itemsByTaskId?: Record<string, ChangeRequestImpactMapItem[]>;
  };
};

type ChangeRequestImpactRow = {
  id: string;
  taskId: string;
  title: string;
  status: ChangeRequestStatus;
  impactType: ChangeRequestImpactType | null;
  priority: ChangeRequestPriority | null;
  createdByUserId: string;
  escalatedToUserId: string | null;
  updatedAt: Date;
};

@Injectable()
export class TaskChangeRequestImpactMapService {
  constructor(
    @InjectRepository(ChangeRequest)
    private readonly changeRequestRepo: Repository<ChangeRequest>,
    private readonly querySvc: TaskQueryService,
  ) {}

  async getTaskChangeRequestImpactMap(
    projectId: string,
    taskId: string,
    query: ChangeRequestImpactMapQueryDto,
    requestUser: RequestUser,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<ChangeRequestImpactMapResponse> {
    const tree = await this.querySvc.getTaskTree(
      projectId,
      taskId,
      {
        depth: query.depth,
        limit: query.limit,
        include: 'viewMeta',
        includeCompleted: query.includeCompleted,
        includeDeleted: query.includeDeleted,
        includeSuperseded: query.includeSuperseded,
      },
      requestUser,
      prefetchedMembership,
    );

    const collapsedMode = query.collapsedMode ?? 'respect';
    const visibleTaskIds = this.getVisibleTaskIds(tree.root, collapsedMode);
    const itemLimitPerTask = query.itemLimitPerTask ?? 3;
    const includeItems = query.includeItems === true;

    if (visibleTaskIds.length === 0) {
      return this.emptyResponse(
        projectId,
        tree.meta.rootTaskId,
        tree.meta.depth,
        tree.meta.limit,
        tree.meta.truncated,
        collapsedMode,
        query,
        itemLimitPerTask,
        includeItems,
      );
    }

    const rows = await this.loadChangeRequestRows(
      projectId,
      visibleTaskIds,
      query,
      requestUser.id,
      false,
    );

    const attentionRows =
      query.needsMyAttention === true
        ? rows
        : await this.loadChangeRequestRows(
            projectId,
            visibleTaskIds,
            query,
            requestUser.id,
            true,
          );

    const taskSummaries = this.buildTaskSummaries(rows, attentionRows);
    const summary = this.buildSummary(Object.values(taskSummaries));

    return {
      meta: {
        projectId,
        rootTaskId: tree.meta.rootTaskId,
        depth: tree.meta.depth,
        limit: tree.meta.limit,
        truncated: tree.meta.truncated,
        collapsedMode,
        filters: {
          status: query.status ?? null,
          impactType: query.impactType ?? null,
          priority: query.priority ?? null,
          createdByUserId: query.createdByUserId ?? null,
          escalatedToUserId: query.escalatedToUserId ?? null,
          reviewerUserId: query.reviewerUserId ?? null,
          needsMyAttention: query.needsMyAttention ?? null,
          includeItems,
          itemLimitPerTask,
        },
        generatedAt: new Date().toISOString(),
      },
      summary,
      data: {
        taskSummaries,
        ...(includeItems
          ? { itemsByTaskId: this.buildItemsByTaskId(rows, itemLimitPerTask) }
          : {}),
      },
    };
  }

  private getVisibleTaskIds(
    root: TaskTreeNode,
    collapsedMode: string,
  ): string[] {
    const taskIds: string[] = [];
    const stack: Array<{ node: TaskTreeNode; hidden: boolean }> = [
      { node: root, hidden: false },
    ];

    while (stack.length) {
      const { node, hidden } = stack.pop()!;
      const collapsed =
        collapsedMode === 'respect' && this.isMindmapCollapsed(node.task);

      if (!hidden) taskIds.push(node.task.id);

      for (const child of [...node.children].reverse()) {
        stack.push({ node: child, hidden: hidden || collapsed });
      }
    }

    return taskIds;
  }

  private isMindmapCollapsed(task: TaskListItemSerializer): boolean {
    const mindmapMeta = task.viewMeta?.mindmap;
    return Boolean(
      mindmapMeta &&
        typeof mindmapMeta === 'object' &&
        'collapsed' in mindmapMeta &&
        (mindmapMeta as { collapsed?: unknown }).collapsed === true,
    );
  }

  private async loadChangeRequestRows(
    projectId: string,
    taskIds: string[],
    query: ChangeRequestImpactMapQueryDto,
    userId: string,
    attentionOnly: boolean,
  ): Promise<ChangeRequestImpactRow[]> {
    if (!taskIds.length) return [];

    const qb = this.buildChangeRequestRowsQuery(projectId, taskIds, query);
    if (query.needsMyAttention === true || attentionOnly) {
      applyChangeRequestNeedsMyAttentionScope(qb, userId);
    }

    const rows = await qb.getRawMany<{
      id: string;
      taskId: string;
      title: string;
      status: ChangeRequestStatus;
      impactType: ChangeRequestImpactType | null;
      priority: ChangeRequestPriority | null;
      createdByUserId: string;
      escalatedToUserId: string | null;
      updatedAt: Date;
    }>();

    return rows.map((row) => ({
      ...row,
      updatedAt: new Date(row.updatedAt),
    }));
  }

  private buildChangeRequestRowsQuery(
    projectId: string,
    taskIds: string[],
    query: ChangeRequestImpactMapQueryDto,
  ): SelectQueryBuilder<ChangeRequest> {
    const qb = this.changeRequestRepo
      .createQueryBuilder('changeRequest')
      .distinct(true)
      .leftJoin('changeRequest.task', 'task')
      .leftJoin('task.assignees', 'taskAssignee')
      .leftJoin('changeRequest.reviews', 'review')
      .select('changeRequest.id', 'id')
      .addSelect('changeRequest.taskId', 'taskId')
      .addSelect('changeRequest.title', 'title')
      .addSelect('changeRequest.status', 'status')
      .addSelect('changeRequest.impactType', 'impactType')
      .addSelect('changeRequest.priority', 'priority')
      .addSelect('changeRequest.createdByUserId', 'createdByUserId')
      .addSelect('changeRequest.escalatedToUserId', 'escalatedToUserId')
      .addSelect('changeRequest.updatedAt', 'updatedAt')
      .where('changeRequest.projectId = :projectId', { projectId })
      .andWhere('changeRequest.taskId IN (:...taskIds)', { taskIds });

    if (query.status) {
      qb.andWhere('changeRequest.status = :status', {
        status: query.status,
      });
    }

    if (query.impactType) {
      qb.andWhere('changeRequest.impactType = :impactType', {
        impactType: query.impactType,
      });
    }

    if (query.priority) {
      qb.andWhere('changeRequest.priority = :priority', {
        priority: query.priority,
      });
    }

    if (query.createdByUserId) {
      qb.andWhere('changeRequest.createdByUserId = :createdByUserId', {
        createdByUserId: query.createdByUserId,
      });
    }

    if (query.escalatedToUserId) {
      qb.andWhere('changeRequest.escalatedToUserId = :escalatedToUserId', {
        escalatedToUserId: query.escalatedToUserId,
      });
    }

    if (query.reviewerUserId) {
      qb.andWhere('review.reviewerUserId = :reviewerUserId', {
        reviewerUserId: query.reviewerUserId,
      });
    }

    return qb.orderBy('changeRequest.updatedAt', 'DESC');
  }

  private buildTaskSummaries(
    rows: ChangeRequestImpactRow[],
    attentionRows: ChangeRequestImpactRow[],
  ): Record<string, ChangeRequestImpactMapTaskSummary> {
    const summaries: Record<string, ChangeRequestImpactMapTaskSummary> = {};
    const attentionCountByTaskId = this.countRowsByTaskId(attentionRows);

    for (const row of rows) {
      const summary =
        summaries[row.taskId] ??
        this.createEmptyTaskSummary(row.taskId, attentionCountByTaskId);

      summary.total += 1;
      if (OPEN_CHANGE_REQUEST_STATUSES.has(row.status)) summary.open += 1;
      if (FINAL_CHANGE_REQUEST_STATUSES.has(row.status)) summary.final += 1;
      if (row.status === ChangeRequestStatus.ESCALATED) summary.escalated += 1;
      if (row.priority === ChangeRequestPriority.CRITICAL) summary.critical += 1;

      this.incrementBucket(summary.byStatus, row.status);
      if (row.impactType) {
        this.incrementBucket(summary.byImpactType, row.impactType);
      }
      if (row.priority) this.incrementBucket(summary.byPriority, row.priority);

      if (
        !summary.latestUpdatedAt ||
        row.updatedAt.getTime() > new Date(summary.latestUpdatedAt).getTime()
      ) {
        summary.latestStatus = row.status;
        summary.latestUpdatedAt = row.updatedAt.toISOString();
      }

      summaries[row.taskId] = summary;
    }

    for (const summary of Object.values(summaries)) {
      summary.intensity = this.calculateIntensity(summary);
    }

    return summaries;
  }

  private createEmptyTaskSummary(
    taskId: string,
    attentionCountByTaskId: Map<string, number>,
  ): ChangeRequestImpactMapTaskSummary {
    return {
      taskId,
      total: 0,
      open: 0,
      final: 0,
      escalated: 0,
      critical: 0,
      needsMyAttention: attentionCountByTaskId.get(taskId) ?? 0,
      latestStatus: null,
      latestUpdatedAt: null,
      intensity: 'none',
      byStatus: {},
      byImpactType: {},
      byPriority: {},
    };
  }

  private buildSummary(
    taskSummaries: ChangeRequestImpactMapTaskSummary[],
  ): ChangeRequestImpactMapResponse['summary'] {
    const summary: ChangeRequestImpactMapResponse['summary'] = {
      affectedTaskCount: taskSummaries.length,
      total: 0,
      open: 0,
      final: 0,
      escalated: 0,
      needsMyAttention: 0,
      critical: 0,
      byStatus: {},
      byImpactType: {},
      byPriority: {},
    };

    for (const taskSummary of taskSummaries) {
      summary.total += taskSummary.total;
      summary.open += taskSummary.open;
      summary.final += taskSummary.final;
      summary.escalated += taskSummary.escalated;
      summary.needsMyAttention += taskSummary.needsMyAttention;
      summary.critical += taskSummary.critical;
      this.mergeBuckets(summary.byStatus, taskSummary.byStatus);
      this.mergeBuckets(summary.byImpactType, taskSummary.byImpactType);
      this.mergeBuckets(summary.byPriority, taskSummary.byPriority);
    }

    return summary;
  }

  private buildItemsByTaskId(
    rows: ChangeRequestImpactRow[],
    itemLimitPerTask: number,
  ): Record<string, ChangeRequestImpactMapItem[]> {
    const itemsByTaskId: Record<string, ChangeRequestImpactMapItem[]> = {};
    const sortedRows = [...rows].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    for (const row of sortedRows) {
      const items = itemsByTaskId[row.taskId] ?? [];
      if (items.length >= itemLimitPerTask) continue;

      items.push({
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        status: row.status,
        impactType: row.impactType,
        priority: row.priority,
        createdById: row.createdByUserId,
        escalatedToUserId: row.escalatedToUserId,
        updatedAt: row.updatedAt.toISOString(),
      });

      itemsByTaskId[row.taskId] = items;
    }

    return itemsByTaskId;
  }

  private calculateIntensity(
    summary: ChangeRequestImpactMapTaskSummary,
  ): ChangeRequestImpactIntensity {
    if (summary.total === 0) return 'none';
    if (summary.escalated > 0 || summary.critical > 0 || summary.total >= 5) {
      return 'high';
    }
    if (summary.total >= 2) return 'medium';
    return 'low';
  }

  private countRowsByTaskId(
    rows: ChangeRequestImpactRow[],
  ): Map<string, number> {
    const countByTaskId = new Map<string, number>();
    for (const row of rows) {
      countByTaskId.set(row.taskId, (countByTaskId.get(row.taskId) ?? 0) + 1);
    }
    return countByTaskId;
  }

  private incrementBucket<T extends string>(
    bucket: ChangeRequestBucket<T>,
    key: T,
  ): void {
    bucket[key] = (bucket[key] ?? 0) + 1;
  }

  private mergeBuckets<T extends string>(
    target: ChangeRequestBucket<T>,
    source: ChangeRequestBucket<T>,
  ): void {
    for (const [key, value] of Object.entries(source) as Array<[T, number]>) {
      target[key] = (target[key] ?? 0) + value;
    }
  }

  private emptyResponse(
    projectId: string,
    rootTaskId: string,
    depth: number | 'all',
    limit: number,
    truncated: boolean,
    collapsedMode: string,
    query: ChangeRequestImpactMapQueryDto,
    itemLimitPerTask: number,
    includeItems: boolean,
  ): ChangeRequestImpactMapResponse {
    return {
      meta: {
        projectId,
        rootTaskId,
        depth,
        limit,
        truncated,
        collapsedMode,
        filters: {
          status: query.status ?? null,
          impactType: query.impactType ?? null,
          priority: query.priority ?? null,
          createdByUserId: query.createdByUserId ?? null,
          escalatedToUserId: query.escalatedToUserId ?? null,
          reviewerUserId: query.reviewerUserId ?? null,
          needsMyAttention: query.needsMyAttention ?? null,
          includeItems,
          itemLimitPerTask,
        },
        generatedAt: new Date().toISOString(),
      },
      summary: this.buildSummary([]),
      data: {
        taskSummaries: {},
        ...(includeItems ? { itemsByTaskId: {} } : {}),
      },
    };
  }
}
