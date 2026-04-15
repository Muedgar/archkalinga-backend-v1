import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { WorkspaceMember } from '../entities/workspace-member.entity';

/**
 * Extracts the WorkspaceMember attached by WorkspaceGuard from the request.
 *
 * Usage:
 *   @GetWorkspaceMember() member: WorkspaceMember
 */
export const GetWorkspaceMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceMember => {
    const request = ctx.switchToHttp().getRequest<{ workspaceMember: WorkspaceMember }>();
    return request.workspaceMember;
  },
);
