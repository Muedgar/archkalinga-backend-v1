import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class TaskListProjectRoleSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status?: boolean;
  @Expose() permissions?: Record<string, Record<string, boolean>>;
}

class TaskListAssignedMemberSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose() firstName: string | null;
  @Expose() lastName: string | null;
  @Expose() email: string | null;
  @Expose() title: string | null;
  @Expose() projectRoleId: string | null;
  @Expose()
  @Type(() => TaskListProjectRoleSnippet)
  projectRole: TaskListProjectRoleSnippet | null;
  @Expose()
  @Transform(({ obj }) => obj?.assignmentRole ?? null)
  assignmentRole: string | null;
}

class TaskListReporteeSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose()
  @Transform(({ obj }) => obj?.firstName ?? null)
  firstName: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.lastName ?? null)
  lastName: string | null;
  @Expose() email: string | null;
  @Expose() title: string | null;
  @Expose() projectRoleId: string | null;
  @Expose()
  @Type(() => TaskListProjectRoleSnippet)
  projectRole: TaskListProjectRoleSnippet | null;
}

class TaskListChecklistItemSerializer extends BaseSerializer {
  @Expose() text?: string;
  @Expose() completed: boolean;
  @Expose() orderIndex: number;
}

class TaskListCommentSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() authorUserId: string;
  @Expose() body: string;
  @Expose() parentCommentId: string | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

class TaskListDependencySerializer extends BaseSerializer {
  @Expose() dependsOnTaskId: string;
  @Expose() dependencyType: string;
  @Expose() lagDays: number | null;
}

class TaskListConfigSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
}

class TaskListStatusSnippet extends TaskListConfigSnippet {
  @Expose() category: string;
  @Expose() isTerminal: boolean;
}

export class TaskListItemSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() parentTaskId: string | null;

  @Expose() statusId: string;
  @Expose()
  @Transform(({ obj }) => obj?.status ?? null)
  @Type(() => TaskListStatusSnippet)
  status: TaskListStatusSnippet | null;

  @Expose() priorityId: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.priority ?? null)
  @Type(() => TaskListConfigSnippet)
  priority: TaskListConfigSnippet | null;

  @Expose() taskTypeId: string;
  @Expose()
  @Transform(({ obj }) => obj?.taskType ?? null)
  @Type(() => TaskListConfigSnippet)
  taskType: TaskListConfigSnippet | null;

  @Expose() severityId: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.severity ?? null)
  @Type(() => TaskListConfigSnippet)
  severity: TaskListConfigSnippet | null;

  @Expose() title: string;
  @Expose() description: Record<string, unknown> | null;
  @Expose() startDate: string | null;
  @Expose() endDate: string | null;
  @Expose() progress: number | null;
  @Expose() completed: boolean;
  @Expose() rank: string | null;
  @Expose() createdByUserId: string;

  @Expose()
  @Type(() => TaskListAssignedMemberSerializer)
  assignedMembers: TaskListAssignedMemberSerializer[];

  @Expose()
  @Type(() => TaskListReporteeSerializer)
  reportee: TaskListReporteeSerializer | null;

  @Expose()
  @Transform(({ obj }) =>
    [...(obj?.checklistItems ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
  )
  @Type(() => TaskListChecklistItemSerializer)
  checklistItems: TaskListChecklistItemSerializer[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.comments ?? []).filter((comment) => !comment.deletedAt),
  )
  @Type(() => TaskListCommentSerializer)
  comments: TaskListCommentSerializer[];

  @Expose()
  @Transform(({ obj }) => obj?.dependencies ?? obj?.dependencyEdges ?? [])
  @Type(() => TaskListDependencySerializer)
  dependencies: TaskListDependencySerializer[];

  @Expose()
  @Transform(({ obj }) => {
    const entries = obj?.viewMetadataEntries ?? [];
    return entries.reduce((acc, entry) => {
      acc[entry.viewType] = entry.metaJson ?? {};
      return acc;
    }, {});
  })
  viewMeta: Record<string, unknown>;

  @Expose()
  @Transform(({ obj }) => obj?.childCount ?? 0)
  childCount: number;

  @Expose()
  @Transform(({ obj }) => obj?.commentCount ?? 0)
  commentCount: number;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
