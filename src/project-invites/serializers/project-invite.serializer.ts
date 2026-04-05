import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class InviterSnippet {
  @Expose() id: string;
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
}

class ProjectRoleSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

/**
 * Full project-invite response shape.
 * Returned by create, list, resend, and accept endpoints.
 */
export class ProjectInviteSerializer extends BaseSerializer {
  // ── Core fields ───────────────────────────────────────────────────────────
  @Expose() projectId: string;
  @Expose() inviterUserId: string;
  @Expose() inviteeEmail: string;
  @Expose() projectRoleId: string;
  @Expose() status: string;
  @Expose() expiresAt: Date;
  @Expose() acceptedAt: Date | null;

  @Expose()
  @Type(() => ProjectRoleSnippet)
  @Transform(({ obj }) => obj?.projectRole ?? null)
  projectRole: ProjectRoleSnippet | null;

  /** Inviter name — resolved from the joined `inviterUser` relation. */
  @Expose()
  @Transform(({ obj }) => {
    const u = obj?.inviterUser;
    if (!u) return null;
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null;
  })
  inviterName: string | null;

  @Expose()
  @Type(() => InviterSnippet)
  @Transform(({ obj }) => obj?.inviterUser ?? null)
  inviter: InviterSnippet | null;

  // ── Task-context fields ───────────────────────────────────────────────────
  @Expose() taskId: string | null;
  @Expose() subtaskId: string | null;
  @Expose() targetType: string;
  @Expose() targetName: string | null;
  @Expose() projectName: string | null;
  @Expose() message: string | null;
  @Expose() autoAssignOnAccept: boolean;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

/**
 * Minimal shape used when embedding invites inside task/subtask detail
 * (pending-invite rows).
 */
export class PendingInviteSnippetSerializer extends BaseSerializer {
  @Expose() inviteeEmail: string;
  @Expose() projectRoleId: string;
  @Expose() status: string;
  @Expose() targetType: string;
  @Expose() taskId: string | null;
  @Expose() subtaskId: string | null;
  @Expose() autoAssignOnAccept: boolean;
  @Expose() expiresAt: Date;
  @Expose()
  @Type(() => ProjectRoleSnippet)
  @Transform(({ obj }) => obj?.projectRole ?? null)
  projectRole: ProjectRoleSnippet | null;
  @Expose() declare createdAt: Date;
}
