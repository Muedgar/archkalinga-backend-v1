import { Expose, Transform, Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

// ── Nested ────────────────────────────────────────────────────────────────────

class TemplateSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() description: string;
  @Expose() isDefault: boolean;
}

class TemplateSummary extends BaseSerializer {
  @Expose() name: string;
}

class ProjectRoleSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() isSystem: boolean;
  @Expose() isProtected: boolean;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

class MemberSnippet extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
  @Expose() title: string | null;
  @Expose()
  @Transform(({ obj }) => obj?.projectRoleId ?? null)
  projectRoleId: string | null;
  @Expose()
  @Transform(({ obj }) =>
    obj?.projectRole
      ? {
          id: obj.projectRole.id,
          name: obj.projectRole.name,
          slug: obj.projectRole.slug,
          status: obj.projectRole.status,
          isSystem: obj.projectRole.isSystem,
          isProtected: obj.projectRole.isProtected,
          permissions: obj.projectRole.permissions,
        }
      : null,
  )
  projectRole:
    | {
        id: string;
        name: string;
        slug: string;
        status: boolean;
        isSystem: boolean;
        isProtected: boolean;
        permissions: Record<string, Record<string, boolean>>;
      }
    | null;
}

class _InviteeSnippet {
  @Expose() id: string;
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
  @Expose() title: string | null;
}

class _InviteRoleSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() isSystem: boolean;
  @Expose() isProtected: boolean;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

class InviteSnippet extends BaseSerializer {
  /** Who received the invite — safe subset of User fields only. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.inviteeUser
      ? plainToInstance(_InviteeSnippet, obj.inviteeUser, { excludeExtraneousValues: true })
      : null,
  )
  invitee: _InviteeSnippet | null;

  /** Role that will be assigned on acceptance — no raw UUID exposed. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.projectRole
      ? plainToInstance(_InviteRoleSnippet, obj.projectRole, { excludeExtraneousValues: true })
      : null,
  )
  role: _InviteRoleSnippet | null;

  @Expose() status: string;
  @Expose() expiresAt: Date;
  @Expose() message: string | null;
}

class ContributionSnippet extends BaseSerializer {
  @Expose() userId: string;
  @Expose() taskId: string | null;
  @Expose() actionType: string;
  @Expose() declare createdAt: Date;

  /** Resolved from user relation at serialization via @Transform. */
  @Expose()
  @Transform(({ obj }) => {
    const u = obj?.user;
    if (!u) return null;
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  })
  actorName: string | null;
}

// ── List item (paginated GET /projects) ──────────────────────────────────────

export class ProjectListItemSerializer extends BaseSerializer {
  @Expose() workspaceId: string;
  @Expose() title: string;
  @Expose() description: string | null;
  @Expose() startDate: string | null;
  @Expose() endDate: string | null;
  @Expose() type: string;
  @Expose() status: string;
  @Expose() archivedAt: Date | null;

  @Expose()
  @Type(() => TemplateSummary)
  template: TemplateSummary;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Full detail (GET /projects/:id  +  POST/PATCH response) ──────────────────

export class ProjectSerializer extends BaseSerializer {
  @Expose() workspaceId: string;
  @Expose() title: string;
  @Expose() description: string | null;
  @Expose() startDate: string | null;
  @Expose() endDate: string | null;
  @Expose() type: string;
  @Expose() status: string;
  @Expose() archivedAt: Date | null;
  @Expose() createdByUserId: string;

  @Expose()
  @Type(() => TemplateSnippet)
  template: TemplateSnippet;

  @Expose()
  @Transform(({ obj }) =>
    [...(obj?.projectRoles ?? [])].sort(
      (
        a: { createdAt?: Date | string },
        b: { createdAt?: Date | string },
      ) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    ).map((role: {
      id: string;
      name: string;
      slug: string;
      status: boolean;
      isSystem: boolean;
      isProtected: boolean;
      permissions: Record<string, Record<string, boolean>>;
    }) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      status: role.status,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
      permissions: role.permissions,
    })),
  )
  @Type(() => ProjectRoleSnippet)
  projectRoles: ProjectRoleSnippet[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.memberships ?? [])
      .filter((m: { status: string }) => m.status === 'ACTIVE')
      .map((m: {
        user?: {
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          title: string | null;
        } | null;
        projectRoleId?: string | null;
        projectRole?: {
          id: string;
          name: string;
          slug: string;
          status: boolean;
          isSystem: boolean;
          isProtected: boolean;
          permissions: Record<string, Record<string, boolean>>;
        } | null;
      }) => {
        if (!m.user) return null;
        return {
          id: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
          title: m.user.title ?? null,
          projectRoleId: m.projectRoleId ?? null,
          projectRole: m.projectRole
            ? {
                id: m.projectRole.id,
                name: m.projectRole.name,
                slug: m.projectRole.slug,
                status: m.projectRole.status,
                isSystem: m.projectRole.isSystem,
                isProtected: m.projectRole.isProtected,
                permissions: m.projectRole.permissions,
              }
            : null,
        };
      })
      .filter(Boolean),
  )
  @Type(() => MemberSnippet)
  members: MemberSnippet[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.activeInvites ?? obj?.invites ?? [])
      .filter((i: { status: string }) => i.status === 'PENDING')
      .map((invite: Record<string, unknown>) =>
        plainToInstance(InviteSnippet, invite, { excludeExtraneousValues: true }),
      ),
  )
  @Type(() => InviteSnippet)
  invites: InviteSnippet[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.recentContributions ?? obj?.activityLogs ?? []).map((entry: {
      id: string;
      createdAt: Date;
      userId: string;
      taskId: string | null;
      actionType: string;
      user?: {
        firstName?: string;
        lastName?: string;
      } | null;
    }) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      userId: entry.userId,
      taskId: entry.taskId,
      actionType: entry.actionType,
      actorName: entry.user
        ? `${entry.user.firstName ?? ''} ${entry.user.lastName ?? ''}`.trim() || null
        : null,
    })),
  )
  @Type(() => ContributionSnippet)
  recentContributions: ContributionSnippet[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
