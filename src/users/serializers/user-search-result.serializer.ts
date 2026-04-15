import { Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class WorkspaceSnippet {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
}

/**
 * Lightweight user shape returned by GET /users/search.
 * Contains only fields safe for cross-workspace discovery.
 * Does NOT expose security-sensitive or internal fields.
 */
export class UserSearchResultSerializer extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() userName: string | null;
  @Expose() email: string;
  @Expose() title: string | null;

  /**
   * Workspace snippet — populated by the service via a virtual property
   * on the query result object (not a TypeORM relation on User itself).
   */
  @Expose()
  @Type(() => WorkspaceSnippet)
  @Transform(({ obj }) => obj?.workspace ?? null)
  workspace: WorkspaceSnippet | null;
}
