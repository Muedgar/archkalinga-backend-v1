import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { Template, TemplateTask } from 'src/templates/entities';
import {
  Task,
  TaskActionType,
  TaskActivityLog,
  TaskStatus,
} from 'src/tasks/entities';
import { WorkflowColumn } from 'src/tasks/workflow';
import { User } from 'src/users/entities/user.entity';
import { RequestUser } from 'src/auth/types';

import {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectFiltersDto,
  UpdateProjectMemberRoleDto,
} from './dtos';
import {
  DEFAULT_PROJECT_ROLE_SETUP_FAILED,
  INVALID_PROJECT_DATE_RANGE,
  INVALID_PROJECT_MEMBER_ROLE,
  PROJECT_ACCESS_DENIED,
  PROJECT_MEMBER_NOT_FOUND,
  PROJECT_MEMBER_ROLE_CHANGE_FORBIDDEN,
  PROJECT_NOT_FOUND,
  PROJECT_TEMPLATE_CHANGE_FORBIDDEN,
} from './messages';
import {
  Project,
  ProjectActivityLog,
  ProjectActionType,
  ProjectMembership,
  ProjectRole,
  ProjectStatus,
} from './entities';
import { MembershipStatus } from './entities/project-membership.entity';
import { ProjectSerializer, ProjectListItemSerializer } from './serializers';
import { FilterResponse } from 'src/common/interfaces';
import {
  DEFAULT_OWNER_PROJECT_ROLE_SLUG,
  DEFAULT_PROJECT_ROLE_DEFINITIONS,
} from './constants';

const TEMPLATE_NOT_IN_WORKSPACE = 'Template not found in this workspace';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectDetail {
  project: Project;
  memberships: ProjectMembership[];
  invites: Project['invites'];
  recentContributions: ProjectActivityLog[];
}

interface TemplateTaskNode {
  id: string;
  name: string;
  description: string;
  order: number;
  parentTaskId: string | null;
  subtasks: TemplateTaskNode[];
}

const DEFAULT_WORKFLOW_COLUMNS = [
  { name: 'Todo',        statusKey: TaskStatus.TODO,        orderIndex: 0 },
  { name: 'In Progress', statusKey: TaskStatus.IN_PROGRESS, orderIndex: 1 },
  { name: 'In Review',   statusKey: TaskStatus.IN_REVIEW,   orderIndex: 2 },
  { name: 'Done',        statusKey: TaskStatus.DONE,        orderIndex: 3 },
  { name: 'Blocked',     statusKey: TaskStatus.BLOCKED,     orderIndex: 4 },
] as const;

const RANK_WIDTH = 10;
const RANK_BASE  = 36n;
const RANK_STEP  = 1024n;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectRole)
    private readonly projectRoleRepo: Repository<ProjectRole>,
    @InjectRepository(ProjectActivityLog)
    private readonly activityRepo: Repository<ProjectActivityLog>,
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(WorkflowColumn)
    private readonly workflowColumnRepo: Repository<WorkflowColumn>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isWorkspaceAdmin(workspaceMember: WorkspaceMember | undefined): boolean {
    return workspaceMember?.workspaceRole?.slug === 'admin';
  }

  private toSerializer(project: Project & Partial<ProjectDetail>): ProjectSerializer {
    return plainToInstance(ProjectSerializer, project, {
      excludeExtraneousValues: true,
    });
  }

  private ensureDateRange(startDate?: string | null, endDate?: string | null): void {
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException(INVALID_PROJECT_DATE_RANGE);
    }
  }

  /**
   * Returns true when the membership is active AND the role carries the
   * canManageProject flag (Owner and Manager by default).
   */
  private membershipCanManageProject(
    membership: ProjectMembership | null | undefined,
  ): boolean {
    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true &&
      membership.projectRole.permissions?.canManageProject === true
    );
  }

  /**
   * Returns true when the membership is simply active (any role).
   * Used to gate view-only project access.
   */
  private membershipIsActive(
    membership: ProjectMembership | null | undefined,
  ): boolean {
    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true
    );
  }

  /**
   * Load a project after verifying the caller has the required access level.
   *
   * @param requiresManagement  false → any active member may proceed (view actions)
   *                            true  → only members whose role has canManageProject=true
   */
  private async loadAuthorizedProject(
    projectId: string,
    workspaceId: string,
    requestUser: RequestUser,
    requiresManagement: boolean,
    workspaceMember?: WorkspaceMember,
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, workspaceId },
      relations: ['memberships', 'memberships.projectRole'],
    });

    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    if (!this.isWorkspaceAdmin(workspaceMember)) {
      const membership = project.memberships.find(
        (m) => m.userId === requestUser.id && m.status === MembershipStatus.ACTIVE,
      );

      const authorized = requiresManagement
        ? this.membershipCanManageProject(membership)
        : this.membershipIsActive(membership);

      if (!authorized) {
        throw new ForbiddenException(PROJECT_ACCESS_DENIED);
      }
    }

    return project;
  }

  private buildTemplateTaskTree(tasks: TemplateTask[]): TemplateTaskNode[] {
    const taskMap = new Map<string, TemplateTaskNode>();

    tasks.forEach((task) => {
      taskMap.set(task.id, {
        id: task.id,
        name: task.name,
        description: task.description,
        order: task.order,
        parentTaskId: task.parentTaskId ?? null,
        subtasks: [],
      });
    });

    const roots: TemplateTaskNode[] = [];
    for (const task of taskMap.values()) {
      if (task.parentTaskId) {
        const parent = taskMap.get(task.parentTaskId);
        if (parent) {
          parent.subtasks.push(task);
          continue;
        }
      }
      roots.push(task);
    }

    const sortNodes = (nodes: TemplateTaskNode[]): TemplateTaskNode[] =>
      nodes
        .sort((a, b) => a.order - b.order)
        .map((node) => ({ ...node, subtasks: sortNodes(node.subtasks) }));

    return sortNodes(roots);
  }

  private parseRankValue(rank?: string | null): bigint | null {
    if (!rank || !/^[0-9a-z]+$/i.test(rank)) return null;
    let result = 0n;
    for (const char of rank.toLowerCase()) {
      result = result * RANK_BASE + BigInt(parseInt(char, 36));
    }
    return result;
  }

  private formatRankValue(value: bigint): string {
    if (value < 0n) return '0'.repeat(RANK_WIDTH);
    return value.toString(36).padStart(RANK_WIDTH, '0').slice(-RANK_WIDTH);
  }

  private async getNextSeedRank(
    manager: EntityManager,
    projectId: string,
    parentTaskId: string | null,
    workflowColumnId: string | null,
  ): Promise<string> {
    const lastSibling = await manager.findOne(Task, {
      where: {
        projectId,
        deletedAt: IsNull(),
        parentTaskId: parentTaskId ?? IsNull(),
        workflowColumnId: workflowColumnId ?? IsNull(),
      },
      order: { rank: 'DESC', createdAt: 'DESC' },
    });

    if (!lastSibling) return this.formatRankValue(RANK_STEP);
    const lastRank = this.parseRankValue(lastSibling.rank) ?? 0n;
    return this.formatRankValue(lastRank + RANK_STEP);
  }

  private async resolveSeedWorkflowColumn(
    manager: EntityManager,
    project: Project,
  ): Promise<WorkflowColumn> {
    let columns = await manager.find(WorkflowColumn, {
      where: { projectId: project.id },
      order: { orderIndex: 'ASC', createdAt: 'ASC' },
    });

    if (!columns.length) {
      columns = await manager.save(
        DEFAULT_WORKFLOW_COLUMNS.map((col) =>
          manager.create(WorkflowColumn, {
            project,
            projectId: project.id,
            name: col.name,
            statusKey: col.statusKey,
            orderIndex: col.orderIndex,
            wipLimit: null,
            locked: true,
          }),
        ),
      );
    }

    return columns.find((c) => c.name.trim().toLowerCase() === 'todo') ?? columns[0];
  }

  private async ensureDefaultProjectRoles(
    manager: EntityManager,
    project: Project,
  ): Promise<Map<string, ProjectRole>> {
    const existing = await manager.find(ProjectRole, { where: { projectId: project.id } });
    const roleMap = new Map(existing.map((role) => [role.slug, role]));

    for (const def of DEFAULT_PROJECT_ROLE_DEFINITIONS) {
      if (!roleMap.has(def.slug)) {
        const created = await manager.save(
          manager.create(ProjectRole, {
            project,
            projectId: project.id,
            name: def.name,
            slug: def.slug,
            status: true,
            isSystem: def.isSystem,
            isProtected: def.isProtected,
            permissions: def.permissions,
          }),
        );
        roleMap.set(created.slug, created);
      }
    }

    return roleMap;
  }

  private async logSeededTaskActivity(
    manager: EntityManager,
    project: Project,
    task: Task,
    actorUser: User,
    templateTaskId: string,
  ): Promise<void> {
    const actionMeta = {
      seededFromTemplate: true,
      templateTaskId,
      workflowColumnId: task.workflowColumnId,
      parentTaskId: task.parentTaskId,
    };

    await manager.save(
      manager.create(TaskActivityLog, {
        taskId: task.id,
        projectId: project.id,
        actorUser,
        actorUserId: actorUser.id,
        actionType: TaskActionType.TASK_CREATED,
        actionMeta,
      }),
    );

    await manager.save(
      manager.create(ProjectActivityLog, {
        project,
        projectId: project.id,
        user: actorUser,
        userId: actorUser.id,
        taskId: task.id,
        actionType: TaskActionType.TASK_CREATED,
        actionMeta,
      }),
    );
  }

  private async createProjectTaskFromTemplate(
    manager: EntityManager,
    project: Project,
    actorUser: User,
    workflowColumn: WorkflowColumn,
    templateTask: TemplateTaskNode,
    parentTask: Task | null = null,
  ): Promise<number> {
    const rank = await this.getNextSeedRank(
      manager,
      project.id,
      parentTask?.id ?? null,
      workflowColumn.id,
    );

    const savedTask = await manager.save(
      manager.create(Task, {
        project,
        projectId: project.id,
        parent: parentTask,
        parentTaskId: parentTask?.id ?? null,
        workflowColumn,
        workflowColumnId: workflowColumn.id,
        createdByUser: actorUser,
        createdByUserId: actorUser.id,
        title: templateTask.name.trim(),
        description: templateTask.description?.trim() ?? null,
        status: TaskStatus.TODO,
        priority: null,
        startDate: null,
        endDate: null,
        progress: null,
        completed: false,
        rank,
        deletedAt: null,
      }),
    );

    await this.logSeededTaskActivity(manager, project, savedTask, actorUser, templateTask.id);

    let createdCount = 1;
    for (const child of templateTask.subtasks) {
      createdCount += await this.createProjectTaskFromTemplate(
        manager,
        project,
        actorUser,
        workflowColumn,
        child,
        savedTask,
      );
    }

    return createdCount;
  }

  private async seedProjectTasksFromTemplate(
    manager: EntityManager,
    project: Project,
    actorUser: User,
    template: Template,
    workflowColumn: WorkflowColumn,
  ): Promise<number> {
    const templateTree = this.buildTemplateTaskTree(template.tasks ?? []);
    let createdCount = 0;
    for (const rootTask of templateTree) {
      createdCount += await this.createProjectTaskFromTemplate(
        manager,
        project,
        actorUser,
        workflowColumn,
        rootTask,
      );
    }
    return createdCount;
  }

  private async loadFull(projectId: string, workspaceId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, workspaceId },
      relations: [
        'template',
        'projectRoles',
        'memberships',
        'memberships.user',
        'memberships.projectRole',
        'invites',
        'invites.projectRole',
        'invites.inviteeUser',
        'activityLogs',
        'activityLogs.user',
      ],
      order: { activityLogs: { createdAt: 'DESC' } },
    });

    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  // ---------------------------------------------------------------------------
  // Create project
  // ---------------------------------------------------------------------------

  async createProject(
    dto: CreateProjectDto,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<ProjectSerializer> {
    const { id: userId } = requestUser;
    this.ensureDateRange(dto.startDate, dto.endDate ?? null);

    const template = await this.templateRepo.findOne({
      where: { id: dto.templateId, workspaceId },
      relations: ['tasks'],
      order: { tasks: { order: 'ASC' } },
    });
    if (!template) throw new NotFoundException(TEMPLATE_NOT_IN_WORKSPACE);

    const workspaceRecord = await this.workspaceRepo.findOneOrFail({ where: { id: workspaceId } });
    const creatorUser     = await this.userRepo.findOneOrFail({ where: { id: userId } });

    const project = await this.projectRepo.manager.transaction(async (tx) => {
      const proj = tx.create(Project, {
        title: dto.title,
        description: dto.description,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        type: dto.type,
        status: ProjectStatus.ACTIVE,
        workspace: workspaceRecord,
        workspaceId,
        template,
        templateId: dto.templateId,
        createdByUser: creatorUser,
        createdByUserId: userId,
      });

      const savedProj  = await tx.save(proj);
      const projRecord = await tx.findOneOrFail(Project, { where: { pkid: savedProj.pkid } });

      // Seed all default project roles (Owner, Manager, Contributor, Reviewer, Viewer)
      const projectRoles = await this.ensureDefaultProjectRoles(tx, projRecord);
      const ownerRole    = projectRoles.get(DEFAULT_OWNER_PROJECT_ROLE_SLUG);
      if (!ownerRole) throw new NotFoundException(DEFAULT_PROJECT_ROLE_SETUP_FAILED);

      // Creator is always the sole initial member with the Owner project role
      await tx.save(
        tx.create(ProjectMembership, {
          project: projRecord,
          projectId: projRecord.id,
          user: creatorUser,
          userId,
          projectRole: ownerRole,
          projectRoleId: ownerRole.id,
          status: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        }),
      );

      const seedColumn      = await this.resolveSeedWorkflowColumn(tx, projRecord);
      const seededTaskCount = await this.seedProjectTasksFromTemplate(
        tx,
        projRecord,
        creatorUser,
        template,
        seedColumn,
      );

      await tx.save(
        tx.create(ProjectActivityLog, {
          project: projRecord,
          projectId: projRecord.id,
          user: creatorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_CREATED,
          actionMeta: {
            title: dto.title,
            seededTaskCount,
            seedWorkflowColumnId: seedColumn.id,
            seedWorkflowColumnName: seedColumn.name,
          },
        }),
      );

      return projRecord;
    });

    return this.toSerializer(await this.loadFull(project.id, workspaceId));
  }

  // ---------------------------------------------------------------------------
  // Update project
  // ---------------------------------------------------------------------------

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<ProjectSerializer> {
    const { id: userId } = requestUser;
    const actorUser = await this.userRepo.findOneOrFail({ where: { id: userId } });

    const projectWithAccess = await this.loadAuthorizedProject(
      projectId,
      workspaceId,
      requestUser,
      true, // requiresManagement
      workspaceMember,
    );
    const project = await this.projectRepo.findOne({ where: { id: projectId, workspaceId } });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    this.ensureDateRange(
      dto.startDate ?? project.startDate,
      dto.endDate ?? project.endDate,
    );

    if (dto.templateId && dto.templateId !== project.templateId) {
      const existingTaskCount = await this.taskRepo.count({
        where: { projectId, deletedAt: IsNull() },
      });
      if (existingTaskCount > 0) throw new ConflictException(PROJECT_TEMPLATE_CHANGE_FORBIDDEN);

      const newTemplate = await this.templateRepo.findOne({
        where: { id: dto.templateId, workspaceId },
      });
      if (!newTemplate) throw new NotFoundException(TEMPLATE_NOT_IN_WORKSPACE);
      project.template   = newTemplate;
      project.templateId = dto.templateId;
    }

    if (dto.title       !== undefined) project.title       = dto.title;
    if (dto.description !== undefined) project.description = dto.description ?? null;
    if (dto.startDate   !== undefined) project.startDate   = dto.startDate ?? null;
    if (dto.endDate     !== undefined) project.endDate     = dto.endDate ?? null;
    if (dto.type        !== undefined) project.type        = dto.type;
    if (dto.status      !== undefined) {
      project.status     = dto.status;
      project.archivedAt = dto.status === ProjectStatus.ARCHIVED
        ? project.archivedAt ?? new Date()
        : null;
    }

    await this.projectRepo.manager.transaction(async (tx) => {
      await tx.save(project);

      if (dto.status !== undefined) {
        await tx.save(
          tx.create(ProjectActivityLog, {
            project,
            projectId,
            user: actorUser,
            userId,
            taskId: null,
            actionType: ProjectActionType.STATUS_CHANGED,
            actionMeta: { status: project.status, archivedAt: project.archivedAt },
          }),
        );
      }

      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId,
          user: actorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_UPDATED,
          actionMeta: {
            updatedFields: Object.keys(dto),
            activeMemberCount: projectWithAccess.memberships.filter(
              (m) => m.status === MembershipStatus.ACTIVE,
            ).length,
          },
        }),
      );
    });

    return this.toSerializer(await this.loadFull(projectId, workspaceId));
  }

  // ---------------------------------------------------------------------------
  // Get one project
  // ---------------------------------------------------------------------------

  async getProject(
    projectId: string,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<ProjectSerializer> {
    const project = await this.loadFull(projectId, workspaceId);
    await this.loadAuthorizedProject(projectId, workspaceId, requestUser, false, workspaceMember); // view: any member
    const recentContributions = project.activityLogs.slice(0, 20);
    return this.toSerializer({ ...project, recentContributions } as unknown as Project);
  }

  // ---------------------------------------------------------------------------
  // Get all projects (paginated, membership-aware)
  // ---------------------------------------------------------------------------

  async getProjects(
    filters: ProjectFiltersDto,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<FilterResponse<ProjectListItemSerializer>> {
    const { id: userId } = requestUser;
    const { page, limit, search, type, status, templateId, orderBy, sortOrder } = filters;
    const isAdmin = this.isWorkspaceAdmin(workspaceMember);

    const qb = this.projectRepo
      .createQueryBuilder('p')
      .distinct(true)
      .leftJoinAndSelect('p.template', 'tpl')
      .leftJoinAndSelect('p.memberships', 'mem', 'mem.status = :activeStatus', {
        activeStatus: MembershipStatus.ACTIVE,
      })
      .where('p.workspaceId = :workspaceId', { workspaceId });

    if (!isAdmin) {
      // Any active member can see the project in their list regardless of role.
      qb.innerJoin(
        'p.memberships',
        'access_mem',
        'access_mem.userId = :userId AND access_mem.status = :memberStatus',
        { userId, memberStatus: MembershipStatus.ACTIVE },
      );
      qb.innerJoin('access_mem.projectRole', 'access_role');
      qb.andWhere('access_role.status = true');
    }

    if (type)       qb.andWhere('p.type = :type', { type });
    if (status)     qb.andWhere('p.status = :status', { status });
    if (templateId) qb.andWhere('p.templateId = :templateId', { templateId });
    if (search) {
      qb.andWhere('(p.title ILIKE :search OR p.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    const col = orderBy && ['title', 'status', 'type', 'createdAt', 'updatedAt'].includes(orderBy)
      ? `p.${orderBy}`
      : 'p.createdAt';
    qb.orderBy(col, sortOrder ?? 'DESC');

    qb.skip((page - 1) * limit).take(limit);

    const [data, count] = await qb.getManyAndCount();

    return {
      items: plainToInstance(ProjectListItemSerializer, data, { excludeExtraneousValues: true }),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // Delete project
  // ---------------------------------------------------------------------------

  async deleteProject(
    projectId: string,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<{ id: string; deleted: true }> {
    const project = await this.loadAuthorizedProject(
      projectId,
      workspaceId,
      requestUser,
      true, // requiresManagement
      workspaceMember,
    );
    await this.projectRepo.remove(project);
    return { id: projectId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Update a member's project role
  // ---------------------------------------------------------------------------

  async updateMemberRole(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberRoleDto,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
  ): Promise<ProjectSerializer> {
    const { id: userId } = requestUser;
    const actorUser = await this.userRepo.findOneOrFail({ where: { id: userId } });

    await this.loadAuthorizedProject(projectId, workspaceId, requestUser, true, workspaceMember); // requiresManagement

    await this.projectRepo.manager.transaction(async (tx) => {
      const project = await tx.findOneOrFail(Project, { where: { id: projectId, workspaceId } });

      const membership = await tx.findOne(ProjectMembership, {
        where: { projectId, userId: memberId, status: MembershipStatus.ACTIVE },
        relations: ['projectRole'],
      });

      if (!membership) throw new NotFoundException(PROJECT_MEMBER_NOT_FOUND);
      if (membership.projectRole?.isProtected === true) {
        throw new BadRequestException(PROJECT_MEMBER_ROLE_CHANGE_FORBIDDEN);
      }

      const nextRole = await tx.findOne(ProjectRole, {
        where: { id: dto.projectRoleId, projectId, status: true },
      });
      if (!nextRole) throw new BadRequestException(INVALID_PROJECT_MEMBER_ROLE);

      membership.projectRole   = nextRole;
      membership.projectRoleId = nextRole.id;
      await tx.save(membership);

      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId,
          user: actorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_UPDATED,
          actionMeta: {
            updatedMemberId: memberId,
            projectRoleId: nextRole.id,
            projectRoleSlug: nextRole.slug,
          },
        }),
      );
    });

    return this.toSerializer(await this.loadFull(projectId, workspaceId));
  }
}
