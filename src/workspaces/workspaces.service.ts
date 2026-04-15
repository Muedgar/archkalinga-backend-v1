import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { UpdateWorkspaceSettingsDto } from './dtos';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember, WorkspaceMemberStatus } from './entities/workspace-member.entity';
import { WorkspaceSerializer } from './serializers';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
  ) {}

  /** Generate a URL-safe slug from a workspace name, guaranteed unique. */
  async generateSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200);

    let slug = base;
    let attempt = 0;
    while (true) {
      const exists = await this.workspaceRepo.findOne({ where: { slug } });
      if (!exists) return slug;
      attempt++;
      slug = `${base}-${attempt}`;
    }
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findOne({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  /**
   * Return all workspaces the user belongs to (ACTIVE memberships only),
   * with workspaceRole and workspace relations loaded.
   * Ordered by joinedAt ASC so the earliest workspace is first.
   */
  async getMembershipsWithWorkspace(userId: string): Promise<WorkspaceMember[]> {
    return this.memberRepo.find({
      where: { userId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['workspace', 'workspaceRole'],
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * Return the user's membership for a specific workspace, with workspaceRole
   * and workspace relations loaded.
   * Throws 404 if the user is not an active member.
   */
  async getMyMembership(userId: string, workspaceId: string): Promise<WorkspaceMember> {
    const member = await this.memberRepo.findOne({
      where: { userId, workspaceId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['workspace', 'workspaceRole'],
    });
    if (!member) throw new NotFoundException('Workspace membership not found');
    return member;
  }

  /**
   * Load the user's first active workspace membership (ordered by joinedAt ASC).
   * Used to populate workspace context in auth responses.
   * Returns null if the user has no active memberships.
   */
  async getFirstActiveMembership(userId: string): Promise<WorkspaceMember | null> {
    const memberships = await this.memberRepo.find({
      where: { userId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['workspace', 'workspaceRole'],
      order: { joinedAt: 'ASC' },
      take: 1,
    });
    return memberships[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Workspace settings (admin-only)
  // ---------------------------------------------------------------------------

  /**
   * Update workspace-level settings: name, description, and allowPublicProfiles.
   *
   * The caller must be an ACTIVE member of the workspace whose role has
   * `userManagement.update` permission (i.e. an admin or manager-level role).
   */
  async updateSettings(
    workspaceId: string,
    requestUserId: string,
    dto: UpdateWorkspaceSettingsDto,
  ): Promise<WorkspaceSerializer> {
    // Verify caller is an active member with the right permission
    const member = await this.memberRepo.findOne({
      where: { workspaceId, userId: requestUserId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['workspaceRole'],
    });

    if (!member) {
      throw new NotFoundException('Workspace not found or you are not a member');
    }

    const canManage = member.workspaceRole?.permissions?.['userManagement']?.['update'];
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to update workspace settings',
      );
    }

    const workspace = await this.workspaceRepo.findOne({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (dto.name               !== undefined) workspace.name               = dto.name;
    if (dto.description        !== undefined) workspace.description        = dto.description ?? null;
    if (dto.allowPublicProfiles !== undefined) workspace.allowPublicProfiles = dto.allowPublicProfiles;

    await this.workspaceRepo.save(workspace);

    return plainToInstance(WorkspaceSerializer, workspace, { excludeExtraneousValues: true });
  }

  /** @deprecated Use getMembershipsWithWorkspace instead */
  async getMemberWorkspaces(userId: string): Promise<Workspace[]> {
    const memberships = await this.memberRepo.find({
      where: { userId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['workspace'],
      order: { joinedAt: 'ASC' },
    });
    return memberships.map((m) => m.workspace);
  }
}
