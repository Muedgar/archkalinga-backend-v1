import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceMember, WorkspaceMemberStatus } from '../entities/workspace-member.entity';
import { User } from 'src/users/entities';

export const WORKSPACE_MEMBER_KEY = 'workspaceMember';

const WORKSPACE_HEADER = 'x-workspace-id';
const MISSING_WORKSPACE_HEADER = 'X-Workspace-Id header is required for this endpoint';
const WORKSPACE_NOT_FOUND = 'Workspace not found or access denied';
const WORKSPACE_SUSPENDED = 'Your access to this workspace has been suspended';

/**
 * WorkspaceGuard
 *
 * Reads the X-Workspace-Id header, looks up the active WorkspaceMember
 * record for the authenticated user, and attaches it to req.workspaceMember
 * (with workspaceRole loaded so PermissionGuard can read the matrix).
 *
 * Must be placed AFTER JwtAuthGuard so request.user is populated.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, WorkspaceGuard, PermissionGuard)
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: User;
      workspaceMember?: WorkspaceMember;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const rawHeader = request.headers[WORKSPACE_HEADER];
    const workspaceId =
      typeof rawHeader === 'string' ? rawHeader.trim() : undefined;

    if (!workspaceId) {
      throw new UnauthorizedException(MISSING_WORKSPACE_HEADER);
    }

    const userId = request.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required');
    }

    const member = await this.memberRepo.findOne({
      where: { workspaceId, userId },
      relations: ['workspaceRole', 'workspace'],
    });

    if (!member) {
      throw new NotFoundException(WORKSPACE_NOT_FOUND);
    }

    if (member.status !== WorkspaceMemberStatus.ACTIVE) {
      throw new ForbiddenException(WORKSPACE_SUSPENDED);
    }

    request.workspaceMember = member;
    return true;
  }
}
