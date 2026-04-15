import { Expose, Transform } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

// ── Nested snippets ───────────────────────────────────────────────────────────
//
// Each snippet is a plain class with only @Expose() fields.
// plainToInstance(..., { excludeExtraneousValues: true }) is called explicitly
// inside each @Transform so that the raw entity is filtered before being
// returned — without this, @Transform returns the raw entity and @Type()
// conversion is ignored, causing all fields (including password, pkid, etc.)
// to bleed through.

class UserSnippet {
  @Expose() id: string;
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() email: string;
  @Expose() title: string | null;
}

class RoleSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() permissions: Record<string, boolean | Record<string, boolean>>;
}

class ProjectSnippet {
  @Expose() id: string;
  @Expose() title: string;
}

// ── Serializer ────────────────────────────────────────────────────────────────

/**
 * Public shape of a ProjectInvite in API responses.
 *
 * Relations are resolved via @Transform + plainToInstance so that only
 * @Expose() fields are emitted — never raw entity data.
 *
 * Used by: create, list (sent), list (received), resend, cancel, accept, decline.
 */
export class ProjectInviteSerializer extends BaseSerializer {
  @Expose() status: string;
  @Expose() expiresAt: Date;
  @Expose() acceptedAt: Date | null;
  @Expose() message: string | null;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  /** Project context — id + title instead of a bare projectId UUID. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.project
      ? plainToInstance(ProjectSnippet, obj.project, { excludeExtraneousValues: true })
      : null,
  )
  project: ProjectSnippet | null;

  /** Who sent the invite. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.inviterUser
      ? plainToInstance(UserSnippet, obj.inviterUser, { excludeExtraneousValues: true })
      : null,
  )
  inviter: UserSnippet | null;

  /** Who received the invite. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.inviteeUser
      ? plainToInstance(UserSnippet, obj.inviteeUser, { excludeExtraneousValues: true })
      : null,
  )
  invitee: UserSnippet | null;

  /** Project role that will be assigned on acceptance. */
  @Expose()
  @Transform(({ obj }) =>
    obj?.projectRole
      ? plainToInstance(RoleSnippet, obj.projectRole, { excludeExtraneousValues: true })
      : null,
  )
  role: RoleSnippet | null;
}
