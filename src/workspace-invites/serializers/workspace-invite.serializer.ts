import { Expose, Transform, plainToInstance } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

// ── Nested snippets ───────────────────────────────────────────────────────────
//
// Keep invite responses intentionally small and prevent raw relation entities
// from exposing internal columns such as pkid, password, or version.

class UserSnippet {
  @Expose() id: string;
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
  @Expose() title: string | null;
}

class WorkspaceSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
}

class WorkspaceRoleSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

// ── Serializer ────────────────────────────────────────────────────────────────

/**
 * Public shape of a WorkspaceInvite in API responses.
 *
 * Used by: create, list (sent), list (received), resend, cancel, accept, decline.
 */
export class WorkspaceInviteSerializer extends BaseSerializer {
  @Expose() status: string;
  @Expose() expiresAt: Date;
  @Expose() acceptedAt: Date | null;
  @Expose() message: string | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  /** Workspace context — id, name, and slug instead of a bare workspaceId UUID. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.workspace
      ? plainToInstance(WorkspaceSnippet, obj.workspace, {
          excludeExtraneousValues: true,
        })
      : null,
  )
  workspace: WorkspaceSnippet | null;

  /** Who sent the invite. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.inviterUser
      ? plainToInstance(UserSnippet, obj.inviterUser, {
          excludeExtraneousValues: true,
        })
      : null,
  )
  inviter: UserSnippet | null;

  /** Who received the invite. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.inviteeUser
      ? plainToInstance(UserSnippet, obj.inviteeUser, {
          excludeExtraneousValues: true,
        })
      : null,
  )
  invitee: UserSnippet | null;

  /** Workspace role that will be assigned on acceptance. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.workspaceRole
      ? plainToInstance(WorkspaceRoleSnippet, obj.workspaceRole, {
          excludeExtraneousValues: true,
        })
      : null,
  )
  role: WorkspaceRoleSnippet | null;
}
