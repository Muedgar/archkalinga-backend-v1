import { Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

/** Public shape of a Workspace in API responses. */
export class WorkspaceSerializer extends BaseSerializer {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() description: string | null;
  @Expose() allowPublicProfiles: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
