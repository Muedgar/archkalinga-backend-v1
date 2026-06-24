import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export class TaskChecklistItemDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() checklistGroupId: string | null;
  @Expose() text: string;
  @Expose() completed: boolean;
  @Expose() orderIndex: number;
  @Expose() completedByUserId: string | null;
  @Expose() completedAt: Date | null;
}

export class TaskChecklistGroupDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() title: string;
  @Expose() orderIndex: number;

  @Expose()
  @Transform(({ obj }) => obj?.items ?? [])
  @Type(() => TaskChecklistItemDetailSerializer)
  items: TaskChecklistItemDetailSerializer[];
}

export class TaskActivityScheduleDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() durationDays: number | null;
  @Expose() plannedStartDate: string | null;
  @Expose() plannedEndDate: string | null;
  @Expose() plannedStartOffset: number | null;
  @Expose() plannedEndOffset: number | null;
  @Expose() actualStartDate: string | null;
  @Expose() actualEndDate: string | null;
  @Expose() earlyStartOffset: number | null;
  @Expose() earlyFinishOffset: number | null;
  @Expose() lateStartOffset: number | null;
  @Expose() lateFinishOffset: number | null;
  @Expose() earlyStartDate: string | null;
  @Expose() earlyFinishDate: string | null;
  @Expose() lateStartDate: string | null;
  @Expose() lateFinishDate: string | null;
  @Expose() totalFloatDays: number | null;
  @Expose() freeFloatDays: number | null;
  @Expose() isCritical: boolean;
  @Expose() isManuallyScheduled: boolean;
  @Expose() manualReason: string | null;
  @Expose() calculatedAt: Date | null;
}

export class ActivityScheduleRowSerializer extends TaskActivityScheduleDetailSerializer {
  @Expose()
  @Transform(({ obj }) => {
    const task = obj?.task;
    if (!task) return null;
    return {
      id: task.id,
      parentTaskId: task.parentTaskId ?? null,
      title: task.title ?? null,
      scheduleType: task.scheduleType ?? null,
      wbsCode: task.wbsCode ?? null,
      wbsSortKey: task.wbsSortKey ?? null,
      statusId: task.statusId ?? null,
      progress: task.progress ?? null,
      completed: task.completed ?? false,
      startDate: task.startDate ?? null,
      endDate: task.endDate ?? null,
    };
  })
  task: {
    id: string;
    parentTaskId: string | null;
    title: string | null;
    scheduleType: string | null;
    wbsCode: string | null;
    wbsSortKey: string | null;
    statusId: string | null;
    progress: number | null;
    completed: boolean;
    startDate: string | null;
    endDate: string | null;
  } | null;

  @Expose()
  @Transform(({ obj }) =>
    (obj?.task?.dependencyEdges ?? []).map((dependency) => {
      const predecessor = dependency.dependsOnTask;
      return {
        id: dependency.id,
        dependsOnTaskId: dependency.dependsOnTaskId,
        dependencyType: dependency.dependencyType,
        lagDays: dependency.lagDays ?? 0,
        predecessor: predecessor
          ? {
              id: predecessor.id,
              title: predecessor.title ?? null,
              wbsCode: predecessor.wbsCode ?? null,
              scheduleType: predecessor.scheduleType ?? null,
              startDate: predecessor.startDate ?? null,
              endDate: predecessor.endDate ?? null,
            }
          : null,
      };
    }),
  )
  predecessors: {
    id: string;
    dependsOnTaskId: string;
    dependencyType: string;
    lagDays: number;
    predecessor: {
      id: string;
      title: string | null;
      wbsCode: string | null;
      scheduleType: string | null;
      startDate: string | null;
      endDate: string | null;
    } | null;
  }[];
}

export class TaskCommentDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() authorUserId: string;
  @Expose() body: string;
  @Expose() parentCommentId: string | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  @Expose()
  @Transform(({ obj }) => {
    const author = obj?.authorUser;
    if (!author) return null;
    return {
      id: author.id,
      firstName: author.firstName ?? null,
      lastName: author.lastName ?? null,
      email: author.email ?? null,
      title: author.title ?? null,
    };
  })
  author: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    title: string | null;
  } | null;
}

export class TaskDependencyDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() dependsOnTaskId: string;
  @Expose() dependencyType: string;
  @Expose() lagDays: number | null;

  @Expose()
  @Transform(({ obj }) => {
    const predecessor = obj?.dependsOnTask;
    if (!predecessor) return null;
    return {
      id: predecessor.id,
      title: predecessor.title ?? null,
      status: predecessor.status ?? null,
      startDate: predecessor.startDate ?? null,
      endDate: predecessor.endDate ?? null,
    };
  })
  dependsOnTask: {
    id: string;
    title: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
}

export class TaskLabelDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() labelId: string;

  @Expose()
  @Transform(({ obj }) => {
    const l = obj?.label;
    if (!l) return null;
    return { id: l.id, name: l.name, key: l.key, color: l.color };
  })
  label: { id: string; name: string; key: string; color: string } | null;
}

export class TaskWatcherDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() userId: string;

  @Expose()
  @Transform(({ obj }) => {
    const u = obj?.user;
    if (!u) return null;
    return {
      id: u.id,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      email: u.email ?? null,
    };
  })
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

export class TaskRelationDetailSerializer extends BaseSerializer {
  @Expose() taskId: string;
  @Expose() relatedTaskId: string;
  @Expose() relationType: string;
  /** 'outgoing' = current task is the source; 'incoming' = current task is the target. */
  @Expose() direction: 'outgoing' | 'incoming';

  @Expose()
  @Transform(({ obj }) => {
    const t = obj?.relatedTask;
    if (!t) return null;
    return {
      id: t.id,
      title: t.title ?? null,
      statusId: t.statusId ?? null,
    };
  })
  relatedTask: {
    id: string;
    title: string | null;
    statusId: string | null;
  } | null;
}
