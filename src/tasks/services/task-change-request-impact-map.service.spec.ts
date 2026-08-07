import { ChangeRequestImpactMapQueryDto } from '../dtos';
import {
  ChangeRequestImpactType,
  ChangeRequestPriority,
  ChangeRequestStatus,
} from '../entities';
import { TaskChangeRequestImpactMapService } from './task-change-request-impact-map.service';

type RawChangeRequestRow = {
  id: string;
  taskId: string;
  title: string;
  status: ChangeRequestStatus;
  impactType: ChangeRequestImpactType | null;
  priority: ChangeRequestPriority | null;
  createdByUserId: string;
  escalatedToUserId: string | null;
  updatedAt: Date;
  needsMyAttention?: boolean;
};

class FakeChangeRequestQueryBuilder {
  private params: Record<string, unknown> = {};
  private attentionOnly = false;

  constructor(private readonly rows: RawChangeRequestRow[]) {}

  distinct() {
    return this;
  }

  leftJoin() {
    return this;
  }

  select() {
    return this;
  }

  addSelect() {
    return this;
  }

  where(_condition: string, params?: Record<string, unknown>) {
    this.assignParams(params);
    return this;
  }

  andWhere(_condition: unknown, params?: Record<string, unknown>) {
    this.assignParams(params);
    if (
      _condition?.constructor?.name === 'Brackets' ||
      params &&
      ('attentionUserId' in params ||
        'pendingReviewStatus' in params ||
        'returnedForRevisionStatus' in params ||
        'escalatedStatus' in params)
    ) {
      this.attentionOnly = true;
    }
    return this;
  }

  orderBy() {
    return this;
  }

  async getRawMany() {
    const taskIds = (this.params.taskIds ?? []) as string[];

    return this.rows.filter((row) => {
      if (taskIds.length && !taskIds.includes(row.taskId)) return false;
      if (this.params.status && row.status !== this.params.status) return false;
      if (
        this.params.impactType &&
        row.impactType !== this.params.impactType
      ) {
        return false;
      }
      if (this.params.priority && row.priority !== this.params.priority) {
        return false;
      }
      if (
        this.params.createdByUserId &&
        row.createdByUserId !== this.params.createdByUserId
      ) {
        return false;
      }
      if (
        this.params.escalatedToUserId &&
        row.escalatedToUserId !== this.params.escalatedToUserId
      ) {
        return false;
      }
      if (this.attentionOnly && row.needsMyAttention !== true) return false;
      return true;
    });
  }

  private assignParams(params?: Record<string, unknown>) {
    if (params) this.params = { ...this.params, ...params };
  }
}

function makeTaskNode(
  id: string,
  children: ReturnType<typeof makeTaskNode>[] = [],
  collapsed = false,
) {
  return {
    task: {
      id,
      viewMeta: collapsed ? { mindmap: { collapsed: true } } : { mindmap: {} },
    },
    children,
    checklistItems: [],
    counts: {
      childCount: children.length,
      descendantCount: children.length,
      checklistItemCount: 0,
      completedChecklistItemCount: 0,
      branchedChecklistItemCount: 0,
      commentCount: 0,
    },
    progress: {
      self: null,
      rollup: null,
      completed: false,
    },
    status: null,
  };
}

function makeService(rows: RawChangeRequestRow[], root = makeTaskNode('root')) {
  const repo = {
    createQueryBuilder: jest.fn(
      () => new FakeChangeRequestQueryBuilder(rows) as any,
    ),
  };
  const querySvc = {
    getTaskTree: jest.fn().mockResolvedValue({
      root,
      summary: {},
      meta: {
        projectId: 'project-1',
        rootTaskId: 'root',
        depth: 'all',
        maxDepthVisited: 1,
        limit: 500,
        truncated: false,
        includeDeleted: false,
        includeCompleted: true,
        includeSuperseded: false,
        includes: ['viewMeta'],
      },
    }),
  };

  return {
    service: new TaskChangeRequestImpactMapService(repo as any, querySvc as any),
    querySvc,
  };
}

function rawRow(
  id: string,
  taskId: string,
  status: ChangeRequestStatus,
  updatedAt: string,
  overrides: Partial<RawChangeRequestRow> = {},
): RawChangeRequestRow {
  return {
    id,
    taskId,
    title: `CR ${id}`,
    status,
    impactType: ChangeRequestImpactType.SCHEDULE,
    priority: ChangeRequestPriority.MEDIUM,
    createdByUserId: 'creator-1',
    escalatedToUserId: null,
    updatedAt: new Date(updatedAt),
    ...overrides,
  };
}

describe('TaskChangeRequestImpactMapService response semantics', () => {
  const requestUser = { id: 'user-1' } as any;

  it('returns an empty impact map when the visible subtree has no change requests', async () => {
    const { service } = makeService([]);

    const response = await service.getTaskChangeRequestImpactMap(
      'project-1',
      'root',
      {} as ChangeRequestImpactMapQueryDto,
      requestUser,
      {} as any,
    );

    expect(response.summary).toMatchObject({
      affectedTaskCount: 0,
      total: 0,
      open: 0,
      final: 0,
      escalated: 0,
      needsMyAttention: 0,
      critical: 0,
    });
    expect(response.data.taskSummaries).toEqual({});
    expect(response.data.itemsByTaskId).toBeUndefined();
  });

  it('classifies open/final statuses, buckets, attention counts, and intensity', async () => {
    const rows = [
      rawRow('1', 'root', ChangeRequestStatus.NEW, '2026-08-01T00:00:00Z', {
        needsMyAttention: true,
      }),
      rawRow(
        '2',
        'root',
        ChangeRequestStatus.UNDER_REVIEW,
        '2026-08-02T00:00:00Z',
      ),
      rawRow(
        '3',
        'root',
        ChangeRequestStatus.RETURNED_FOR_REVISION,
        '2026-08-03T00:00:00Z',
      ),
      rawRow(
        '4',
        'root',
        ChangeRequestStatus.APPROVED,
        '2026-08-04T00:00:00Z',
        {
          impactType: ChangeRequestImpactType.COST,
          priority: ChangeRequestPriority.LOW,
        },
      ),
      rawRow(
        '5',
        'root',
        ChangeRequestStatus.REJECTED,
        '2026-08-05T00:00:00Z',
      ),
      rawRow(
        '6',
        'root',
        ChangeRequestStatus.CANCELLED,
        '2026-08-06T00:00:00Z',
      ),
      rawRow(
        '7',
        'root',
        ChangeRequestStatus.ESCALATED,
        '2026-08-07T00:00:00Z',
        {
          priority: ChangeRequestPriority.CRITICAL,
          escalatedToUserId: 'user-1',
          needsMyAttention: true,
        },
      ),
    ];
    const { service } = makeService(rows);

    const response = await service.getTaskChangeRequestImpactMap(
      'project-1',
      'root',
      {} as ChangeRequestImpactMapQueryDto,
      requestUser,
      {} as any,
    );

    expect(response.summary).toMatchObject({
      affectedTaskCount: 1,
      total: 7,
      open: 4,
      final: 3,
      escalated: 1,
      needsMyAttention: 2,
      critical: 1,
    });
    expect(response.summary.byStatus).toMatchObject({
      NEW: 1,
      UNDER_REVIEW: 1,
      RETURNED_FOR_REVISION: 1,
      APPROVED: 1,
      REJECTED: 1,
      CANCELLED: 1,
      ESCALATED: 1,
    });
    expect(response.summary.byImpactType).toMatchObject({
      SCHEDULE: 6,
      COST: 1,
    });
    expect(response.summary.byPriority).toMatchObject({
      MEDIUM: 5,
      LOW: 1,
      CRITICAL: 1,
    });
    expect(response.data.taskSummaries.root).toMatchObject({
      latestStatus: ChangeRequestStatus.ESCALATED,
      latestUpdatedAt: '2026-08-07T00:00:00.000Z',
      intensity: 'high',
    });
  });

  it('applies filters before latest status and preview items are computed', async () => {
    const rows = [
      rawRow(
        'older-open',
        'root',
        ChangeRequestStatus.UNDER_REVIEW,
        '2026-08-01T00:00:00Z',
      ),
      rawRow(
        'latest-final-filtered-out',
        'root',
        ChangeRequestStatus.APPROVED,
        '2026-08-08T00:00:00Z',
      ),
      rawRow(
        'newer-open',
        'root',
        ChangeRequestStatus.UNDER_REVIEW,
        '2026-08-03T00:00:00Z',
      ),
    ];
    const { service } = makeService(rows);

    const response = await service.getTaskChangeRequestImpactMap(
      'project-1',
      'root',
      {
        status: ChangeRequestStatus.UNDER_REVIEW,
        includeItems: true,
        itemLimitPerTask: 1,
      } as ChangeRequestImpactMapQueryDto,
      requestUser,
      {} as any,
    );

    expect(response.summary).toMatchObject({
      total: 2,
      open: 2,
      final: 0,
    });
    expect(response.data.taskSummaries.root.latestStatus).toBe(
      ChangeRequestStatus.UNDER_REVIEW,
    );
    expect(response.data.taskSummaries.root.latestUpdatedAt).toBe(
      '2026-08-03T00:00:00.000Z',
    );
    expect(response.data.itemsByTaskId?.root).toEqual([
      expect.objectContaining({
        id: 'newer-open',
        status: ChangeRequestStatus.UNDER_REVIEW,
      }),
    ]);
  });

  it('respects collapsed mindmap nodes when scoping visible task IDs', async () => {
    const root = makeTaskNode('root', [
      makeTaskNode('collapsed-parent', [makeTaskNode('hidden-child')], true),
    ]);
    const rows = [
      rawRow('visible', 'collapsed-parent', ChangeRequestStatus.NEW, '2026-08-01T00:00:00Z'),
      rawRow('hidden', 'hidden-child', ChangeRequestStatus.NEW, '2026-08-02T00:00:00Z'),
    ];
    const { service } = makeService(rows, root);

    const response = await service.getTaskChangeRequestImpactMap(
      'project-1',
      'root',
      {} as ChangeRequestImpactMapQueryDto,
      requestUser,
      {} as any,
    );

    expect(response.summary.total).toBe(1);
    expect(response.data.taskSummaries['collapsed-parent']).toBeDefined();
    expect(response.data.taskSummaries['hidden-child']).toBeUndefined();
  });
});
