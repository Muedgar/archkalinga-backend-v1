import { Expose, Transform } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

export class ProjectRoleSerializer extends BaseSerializer {
  @Expose() projectId: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() isSystem: boolean;
  @Expose() isProtected: boolean;

  @Expose()
  @Transform(({ obj }: { obj: { permissions?: Record<string, Record<string, boolean>> } }) =>
    obj?.permissions ?? {},
  )
  permissions: Record<string, Record<string, boolean>>;

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
