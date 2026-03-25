import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

// ── Nested ────────────────────────────────────────────────────────────────────

class PhaseSnippet extends BaseSerializer {
  @Expose() title: string;
  @Expose() description: string;
  @Expose() order: number;
}

class TemplateSnippet extends BaseSerializer {
  @Expose() name: string;
  @Expose() description: string;
  @Expose() isDefault: boolean;

  @Expose()
  @Type(() => PhaseSnippet)
  phases: PhaseSnippet[];
}

class TemplateSummary extends BaseSerializer {
  @Expose() name: string;
}

class MemberSnippet extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
  @Expose() title: string | null;
}

class InviteSnippet extends BaseSerializer {
  @Expose() inviteeEmail: string;
  @Expose() role: string;
  @Expose() status: string;
  @Expose() expiresAt: Date;
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
  @Expose() organizationId: string;
  @Expose() title: string;
  @Expose() description: string | null;
  @Expose() startDate: string | null;
  @Expose() endDate: string | null;
  @Expose() type: string;
  @Expose() status: string;

  @Expose()
  @Type(() => TemplateSummary)
  template: TemplateSummary;

  /** Flat list of active member UUIDs. */
  @Expose()
  @Transform(({ obj }) =>
    (obj?.memberships ?? [])
      .filter((m: { status: string }) => m.status === 'ACTIVE')
      .map((m: { userId: string }) => m.userId),
  )
  memberIds: string[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

// ── Full detail (GET /projects/:id  +  POST/PATCH response) ──────────────────

export class ProjectSerializer extends BaseSerializer {
  @Expose() organizationId: string;
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
    (obj?.memberships ?? [])
      .filter((m: { status: string }) => m.status === 'ACTIVE')
      .map((m: { userId: string }) => m.userId),
  )
  memberIds: string[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.memberships ?? [])
      .filter((m: { status: string }) => m.status === 'ACTIVE')
      .map((m: { user: unknown }) => m.user)
      .filter(Boolean),
  )
  @Type(() => MemberSnippet)
  members: MemberSnippet[];

  @Expose()
  @Transform(({ obj }) =>
    (obj?.activeInvites ?? obj?.invites ?? []).filter(
      (i: { status: string }) => i.status === 'PENDING',
    ),
  )
  @Type(() => InviteSnippet)
  invites: InviteSnippet[];

  @Expose()
  @Transform(({ obj }) => obj?.recentContributions ?? obj?.activityLogs ?? [])
  @Type(() => ContributionSnippet)
  recentContributions: ContributionSnippet[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
