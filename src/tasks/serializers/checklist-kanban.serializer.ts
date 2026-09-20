import { ChecklistSubmissionSerializer } from './checklist-submission.serializer';
import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class ChecklistKanbanStatusSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() key: string;
  @Expose() color: string;
  @Expose() orderIndex: number;
  @Expose() canonicalStage: string | null;
  @Expose() category: string;
  @Expose() isDone: boolean;
  @Expose() isActive: boolean;
}

class ChecklistKanbanMemberSerializer {
  @Expose() userId: string;
  @Expose() firstName: string | null;
  @Expose() lastName: string | null;
  @Expose() email: string | null;
  @Expose() title: string | null;
}

export class ChecklistKanbanCardSerializer extends BaseSerializer {
  @Expose() revision: number;
  @Expose() capabilities: Record<string, unknown>;
  @Expose()
  @Type(() => ChecklistSubmissionSerializer)
  activeSubmission: unknown;
  @Expose() description?: Record<string, unknown> | null;
  @Expose() packageManaged?: boolean;
  @Expose() legacyBranch?: boolean;
  @Expose() durationDays?: number;
  @Expose() earliestStartDate?: string | null;
  @Expose() plannedStartDate?: string | null;
  @Expose() plannedEndDate?: string | null;

  @Expose() taskId: string;
  @Expose() taskTitle: string;
  @Expose() parentTaskId: string | null;
  @Expose() itemCode: string | null;
  @Expose() text: string;
  @Expose() statusId: string;
  @Expose() rank: string | null;
  @Expose() completed: boolean;
  @Expose()
  @Transform(({ obj }) => (obj?.completed ? 100 : 0))
  progress: 0 | 100;
  @Expose() branchStatus: string;
  @Expose() branchedTaskId: string | null;
  @Expose() branchedTaskTitle: string | null;
  @Expose() createdByUserId: string;
  @Expose() canBranch: boolean;
  @Expose() canMove: boolean;
  @Expose() canUpdate: boolean;
  @Expose() canUpdateText: boolean;
  @Expose() canManageChecklist: boolean;

  @Expose()
  @Type(() => ChecklistKanbanMemberSerializer)
  assignedMembers: ChecklistKanbanMemberSerializer[];

  @Expose()
  @Type(() => ChecklistKanbanMemberSerializer)
  reportee: ChecklistKanbanMemberSerializer | null;
}

export class ChecklistKanbanBoardSerializer {
  @Expose()
  @Type(() => ChecklistKanbanStatusSerializer)
  columns: ChecklistKanbanStatusSerializer[];

  @Expose()
  @Type(() => ChecklistKanbanCardSerializer)
  cards: ChecklistKanbanCardSerializer[];

  @Expose() columnCounts: Record<string, number>;
  @Expose() meta: {
    projectId: string;
    taskId: string | null;
    page: number;
    limit: number;
    count: number;
    pages: number;
    nextPage: number | null;
    previousPage: number | null;
  };
}
