import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

/**
 * Public shape of a WorkspaceRole in API responses.
 * Returns the full permission matrix so the frontend can build its
 * permission check table without a separate request.
 */
export class RoleSerializer extends BaseSerializer {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() workspaceId: string;
  @Expose() isSystem: boolean;

  @Expose()
  @Transform(
    ({
      obj,
    }: {
      obj: { permissions?: Record<string, Record<string, boolean>> };
    }) => obj?.permissions ?? {},
  )
  permissions: Record<string, Record<string, boolean>>;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
