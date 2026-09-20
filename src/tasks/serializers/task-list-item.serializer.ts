import { ChecklistSubmissionSerializer } from './checklist-submission.serializer';
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

class TaskListChecklistStatusSnippet extends BaseSerializer {
  @Expose() declare id: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() canonicalStage: string | null;
  @Expose() category: string;
  @Expose() isDone: boolean;
}

class TaskListChecklistItemSerializer extends BaseSerializer {
  @Expose() @Transform(({ obj }) => obj.version) revision: number;
  @Expose() capabilities: Record<string, unknown>;
  @Expose()
  @Type(() => ChecklistSubmissionSerializer)
  activeSubmission: unknown;
  @Expose() assignedMembers: unknown;
  @Expose() reporteeUserId: string | null;
  @Expose() description?: Record<string, unknown> | null;
  @Expose() canBranch?: boolean;
  @Expose() packageManaged?: boolean;
  @Expose() legacyBranch?: boolean;
  @Expose() durationDays?: number;
  @Expose() earliestStartDate?: string | null;
  @Expose() plannedStartDate?: string | null;
  @Expose() plannedEndDate?: string | null;

  @Expose() statusId: string;
  @Expose()
  @Transform(({ obj }) => obj?.status ?? null)
  @Type(() => TaskListChecklistStatusSnippet)
  status: TaskListChecklistStatusSnippet | null;
  @Expose() itemCode: string | null;
  @Expose() branchedTaskId: string | null;
  @Expose() branchStatus: string;
  @Expose() branchedByUserId: string | null;
  @Expose() branchedAt: Date | null;
  @Expose() text?: string;
  @Expose() completed: boolean;
  @Expose()
  @Transform(({ obj }) => (obj?.completed ? 100 : 0))
  progress: 0 | 100;
  @Expose() orderIndex: number;
  @Expose() rank: string | null;
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
  @Expose() canonicalStage: string | null;
  @Expose() category: string;
  @Expose() isTerminal: boolean;
  @Expose() isDone: boolean;
  @Expose() completionPolicy: string;
}

class TaskListChecklistSummarySerializer {
  @Expose() total: number;
  @Expose() completed: number;
}

class TaskListActivityScheduleSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() durationDays: number | null;
  @Expose() plannedStartDate: string | null;
  @Expose() plannedEndDate: string | null;
  @Expose() actualStartDate: string | null;
  @Expose() actualEndDate: string | null;
  @Expose() totalFloatDays: number | null;
  @Expose() freeFloatDays: number | null;
  @Expose() isCritical: boolean;
  @Expose() isManuallyScheduled: boolean;
  @Expose() manualReason: string | null;
}

export class TaskListItemSerializer extends BaseSerializer {
  @Expose() capabilities: Record<string, unknown>;
  @Expose()
  @Transform(({ obj }) => obj.revision ?? obj.version)
  revision: number;

  @Expose() projectId: string;
  @Expose() parentTaskId: string | null;
  @Expose() supersededByTaskId: string | null;
  @Expose() supersedesTaskId: string | null;
  @Expose() supersessionReason: string | null;
  @Expose() supersededAt: Date | null;

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
  @Expose() rollupProgress: number | null;
  @Expose() canEditProgress: boolean;
  @Expose() progressEditBlockedReason: string | null;
  @Expose() completed: boolean;
  @Expose() completedAt: Date | null;
  @Expose() completedByUserId: string | null;
  @Expose() scheduleType: string;
  @Expose() wbsCode: string | null;
  @Expose() wbsSortKey: string | null;
  @Expose() weightPercent: number | null;
  @Expose() isManuallyScheduled: boolean;
  @Expose() manualScheduleReason: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.durationDays ?? null)
  durationDays: number | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.plannedStartDate ?? null)
  plannedStartDate: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.plannedEndDate ?? null)
  plannedEndDate: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.actualStartDate ?? null)
  actualStartDate: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.actualEndDate ?? null)
  actualEndDate: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.totalFloatDays ?? null)
  totalFloatDays: number | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.freeFloatDays ?? null)
  freeFloatDays: number | null;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule?.isCritical ?? false)
  isCritical: boolean;
  @Expose()
  @Transform(({ obj }) => obj?.activitySchedule ?? null)
  @Type(() => TaskListActivityScheduleSerializer)
  activitySchedule: TaskListActivityScheduleSerializer | null;
  @Expose() rank: string | null;
  @Expose() createdByUserId: string;

  @Expose()
  @Type(() => TaskListAssignedMemberSerializer)
  assignedMembers: TaskListAssignedMemberSerializer[];

  @Expose()
  @Type(() => TaskListReporteeSerializer)
  reportee: TaskListReporteeSerializer | null;

  @Expose()
  @Transform(({ obj }) => obj?.checklistSummary ?? { total: 0, completed: 0 })
  @Type(() => TaskListChecklistSummarySerializer)
  checklistSummary: TaskListChecklistSummarySerializer;

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
