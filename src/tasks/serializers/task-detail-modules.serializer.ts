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
  relatedTask: { id: string; title: string | null; statusId: string | null } | null;
}
