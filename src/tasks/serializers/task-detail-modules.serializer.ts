import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export class TaskChecklistItemDetailSerializer extends BaseSerializer {
  @Expose() text: string;
  @Expose() completed: boolean;
  @Expose() orderIndex: number;
  @Expose() completedByUserId: string | null;
  @Expose() completedAt: Date | null;
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
  author:
    | {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        title: string | null;
      }
    | null;
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
  dependsOnTask:
    | {
        id: string;
        title: string | null;
        status: string | null;
        startDate: string | null;
        endDate: string | null;
      }
    | null;
}
