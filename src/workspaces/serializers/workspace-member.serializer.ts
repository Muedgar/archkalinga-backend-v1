import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class WorkspaceRoleShape {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() isSystem: boolean;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

class WorkspaceShape {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() description: string | null;
}

/** Public shape of a WorkspaceMember in API responses. */
export class WorkspaceMemberSerializer extends BaseSerializer {
  @Expose() workspaceId: string;
  @Expose() userId: string;
  @Expose() workspaceRoleId: string;
  @Expose() status: string;
  @Expose() joinedAt: Date | null;
  @Expose() declare createdAt: Date;

  @Expose()
  @Transform(({ obj }: { obj: { workspaceRole?: WorkspaceRoleShape | null } }) => {
    const role = obj?.workspaceRole;
    if (!role) return null;
    return {
      id: (role as unknown as { id: string }).id,
      name: role.name,
      slug: role.slug,
      status: role.status,
      isSystem: role.isSystem,
      permissions: role.permissions,
    };
  })
  workspaceRole: WorkspaceRoleShape | null;

  @Expose()
  @Transform(({ obj }: { obj: { workspace?: WorkspaceShape | null } }) => {
    const ws = obj?.workspace;
    if (!ws) return null;
    return {
      id: (ws as unknown as { id: string }).id,
      name: ws.name,
      slug: ws.slug,
      description: ws.description ?? null,
    };
  })
  workspace: WorkspaceShape | null;
}
