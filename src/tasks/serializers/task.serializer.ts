import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class TaskProjectRoleSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status?: boolean;
  @Expose() permissions?: Record<string, Record<string, boolean>>;
}

class TaskAssignedMemberSerializer extends BaseSerializer {
  @Expose() userId: string;
  @Expose() firstName: string | null;
  @Expose() lastName: string | null;
  @Expose() email: string | null;
  @Expose() title: string | null;
  @Expose() projectRoleId: string | null;
  @Expose()
  @Type(() => TaskProjectRoleSnippet)
  projectRole: TaskProjectRoleSnippet | null;
  @Expose()
  @Transform(({ obj }) => obj?.assignmentRole ?? null)
  assignmentRole: string | null;
}

class TaskReporteeSerializer extends BaseSerializer {
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
  @Type(() => TaskProjectRoleSnippet)
  projectRole: TaskProjectRoleSnippet | null;
}

class TaskChecklistItemSerializer extends BaseSerializer {
  @Expose() text: string;
  @Expose() completed: boolean;
  @Expose() orderIndex: number;
  @Expose() completedByUserId: string | null;
  @Expose() completedAt: Date | null;
}

class TaskCommentSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() authorUserId: string;
  @Expose() body: string;
  @Expose() parentCommentId: string | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

class TaskDependencySerializer extends BaseSerializer {
  @Expose() dependsOnTaskId: string;
  @Expose() dependencyType: string;
  @Expose() lagDays: number | null;
}

class ConfigSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
}

class StatusSnippet extends ConfigSnippet {
  @Expose() category: string;
  @Expose() isTerminal: boolean;
}

export class TaskSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() parentTaskId: string | null;

  // Status
  @Expose() statusId: string;
  @Expose()
  @Transform(({ obj }) => obj?.status ?? null)
  @Type(() => StatusSnippet)
  status: StatusSnippet | null;

  // Priority
  @Expose() priorityId: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.priority ?? null)
  @Type(() => ConfigSnippet)
  priority: ConfigSnippet | null;

  // Task Type
  @Expose() taskTypeId: string;
  @Expose()
  @Transform(({ obj }) => obj?.taskType ?? null)
  @Type(() => ConfigSnippet)
  taskType: ConfigSnippet | null;

  // Severity
  @Expose() severityId: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.severity ?? null)
  @Type(() => ConfigSnippet)
  severity: ConfigSnippet | null;

  @Expose() title: string;
  @Expose() description: Record<string, unknown> | null;
  @Expose() startDate: string | null;
  @Expose() endDate: string | null;
  @Expose() progress: number | null;
  @Expose() completed: boolean;
  @Expose() rank: string | null;
  @Expose() createdByUserId: string;
  @Expose() deletedAt: Date | null;

  @Expose()
  @Type(() => TaskAssignedMemberSerializer)
  assignedMembers: TaskAssignedMemberSerializer[];

  @Expose()
  @Type(() => TaskReporteeSerializer)
  reportee: TaskReporteeSerializer | null;

  @Expose()
  @Transform(({ obj }) =>
    [...(obj?.checklistItems ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
  )
  @Type(() => TaskChecklistItemSerializer)
  checklistItems: TaskChecklistItemSerializer[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.comments ?? []).filter((comment) => !comment.deletedAt),
  )
  @Type(() => TaskCommentSerializer)
  comments: TaskCommentSerializer[];

  @Expose()
  @Transform(({ obj }) => obj?.dependencyEdges ?? [])
  @Type(() => TaskDependencySerializer)
  dependencies: TaskDependencySerializer[];

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
