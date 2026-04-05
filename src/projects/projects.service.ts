import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { EntityManager, In, IsNull, Repository } from 'typeorm';

import { Organization } from 'src/organizations/entities/organization.entity';
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

import { CreateProjectDto, UpdateProjectDto, ProjectFiltersDto } from './dtos';
import {
  DEFAULT_PROJECT_ROLE_NOT_FOUND,
  DEFAULT_PROJECT_ROLE_SETUP_FAILED,
  INVALID_PROJECT_DATE_RANGE,
  MEMBER_NOT_IN_ORG,
  PROJECT_ACCESS_DENIED,
  PROJECT_NOT_FOUND,
  PROJECT_TEMPLATE_CHANGE_FORBIDDEN,
  TEMPLATE_NOT_IN_ORG,
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
  CONTRIBUTOR_PROJECT_ACCESS_MATRIX,
  FULL_PROJECT_ACCESS_MATRIX,
  MANAGE_PROJECT_ACCESS_MATRIX,
  type ProjectPermissionAction,
  VIEWER_PROJECT_ACCESS_MATRIX,
} from './types/project-permission-matrix.type';

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
  { name: 'Todo', statusKey: TaskStatus.TODO, orderIndex: 0 },
  { name: 'In Progress', statusKey: TaskStatus.IN_PROGRESS, orderIndex: 1 },
  { name: 'In Review', statusKey: TaskStatus.IN_REVIEW, orderIndex: 2 },
  { name: 'Done', statusKey: TaskStatus.DONE, orderIndex: 3 },
  { name: 'Blocked', statusKey: TaskStatus.BLOCKED, orderIndex: 4 },
] as const;

const RANK_WIDTH = 10;
const RANK_BASE = 36n;
const RANK_STEP = 1024n;
const DEFAULT_PROJECT_ROLE_DEFINITIONS = [
  { name: 'Owner', slug: 'owner', permissions: FULL_PROJECT_ACCESS_MATRIX },
  { name: 'Project Admin', slug: 'project-admin', permissions: MANAGE_PROJECT_ACCESS_MATRIX },
  { name: 'Contributor', slug: 'contributor', permissions: CONTRIBUTOR_PROJECT_ACCESS_MATRIX },
  { name: 'Viewer', slug: 'viewer', permissions: VIEWER_PROJECT_ACCESS_MATRIX },
] as const;

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
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
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

  private isAdmin(user: RequestUser): boolean {
    return (user as unknown as User).role?.slug === 'admin';
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

  private membershipHasProjectPermission(
    membership: ProjectMembership | null | undefined,
    action: ProjectPermissionAction,
  ): boolean {
    return (
      membership?.status === MembershipStatus.ACTIVE &&
      membership.projectRole?.status === true &&
      membership.projectRole.permissions?.projectManagement?.[action] === true
    );
  }

  private async loadAuthorizedProject(
    projectId: string,
    requestUser: RequestUser,
    action: ProjectPermissionAction,
  ): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId: requestUser.organizationId },
      relations: ['memberships', 'memberships.projectRole'],
    });

    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    if (!this.isAdmin(requestUser)) {
      const membership = project.memberships.find(
        (membership) =>
          membership.userId === requestUser.id &&
          membership.status === MembershipStatus.ACTIVE,
      );

      if (!this.membershipHasProjectPermission(membership, action)) {
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
        .map((node) => ({
          ...node,
          subtasks: sortNodes(node.subtasks),
        }));

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

    if (!lastSibling) {
      return this.formatRankValue(RANK_STEP);
    }

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
        DEFAULT_WORKFLOW_COLUMNS.map((column) =>
          manager.create(WorkflowColumn, {
            project,
            projectId: project.id,
            name: column.name,
            statusKey: column.statusKey,
            orderIndex: column.orderIndex,
            wipLimit: null,
            locked: true,
          }),
        ),
      );
    }

    return columns.find((column) => column.name.trim().toLowerCase() === 'todo') ?? columns[0];
  }

  private async ensureDefaultProjectRoles(
    manager: EntityManager,
    project: Project,
  ): Promise<Map<string, ProjectRole>> {
    const existing = await manager.find(ProjectRole, {
      where: { projectId: project.id },
    });

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

  /** Load the full project with all relations needed for detail/response views. */
  private async loadFull(projectId: string, organizationId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
      relations: [
        'template',
        'projectRoles',
        'memberships',
        'memberships.user',
        'memberships.projectRole',
        'invites',
        'invites.projectRole',
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
  ): Promise<ProjectSerializer> {
    const { organizationId, id: userId } = requestUser;
    this.ensureDateRange(dto.startDate, dto.endDate ?? null);

    // 1. Validate template belongs to same org
    const template = await this.templateRepo.findOne({
      where: { id: dto.templateId, organizationId },
      relations: ['tasks'],
      order: { tasks: { order: 'ASC' } },
    });
    if (!template) throw new NotFoundException(TEMPLATE_NOT_IN_ORG);

    // 2. Validate memberIds (if supplied) all belong to same org
    let memberUsers: User[] = [];
    if (dto.memberIds?.length) {
      memberUsers = await this.userRepo.find({
        where: dto.memberIds.map((mid) => ({ id: mid, organizationId })),
      });
      if (memberUsers.length !== dto.memberIds.length) {
        throw new BadRequestException(MEMBER_NOT_IN_ORG);
      }
    }

    // 3. Load relation objects needed to resolve integer FKs inside the transaction
    const orgRecord = await this.orgRepo.findOneOrFail({ where: { id: organizationId } });
    const creatorUser = await this.userRepo.findOneOrFail({ where: { id: userId } });

    const project = await this.projectRepo.manager.transaction(async (tx) => {
      // a. Create project
      const proj = tx.create(Project, {
        title: dto.title,
        description: dto.description,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        type: dto.type,
        status: ProjectStatus.ACTIVE,
        organization: orgRecord,
        organizationId,
        template,
        templateId: dto.templateId,
        createdByUser: creatorUser,
        createdByUserId: userId,
      });
      const savedProj = await tx.save(proj);
      // Reload to get DB-generated UUID
      const projRecord = await tx.findOneOrFail(Project, { where: { pkid: savedProj.pkid } });
      const projectRoles = await this.ensureDefaultProjectRoles(tx, projRecord);
      const ownerRole = projectRoles.get('owner');
      const contributorRole = projectRoles.get('contributor');

      if (!ownerRole || !contributorRole) {
        throw new NotFoundException(DEFAULT_PROJECT_ROLE_SETUP_FAILED);
      }

      // b. Creator membership (OWNER)
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

      // c. Additional member memberships (skip if creator already in list)
      const nonCreatorMembers = memberUsers.filter((u) => u.id !== userId);
      for (const memberUser of nonCreatorMembers) {
        const reloadedMember = await tx.findOneOrFail(User, { where: { pkid: memberUser.pkid } });
        await tx.save(
          tx.create(ProjectMembership, {
            project: projRecord,
            projectId: projRecord.id,
            user: reloadedMember,
            userId: reloadedMember.id,
            projectRole: contributorRole,
            projectRoleId: contributorRole.id,
            status: MembershipStatus.ACTIVE,
            invitedByUser: creatorUser,
            invitedByUserId: userId,
            joinedAt: new Date(),
          }),
        );
      }

      // d. Resolve or create workflow columns, then seed project tasks
      const seedColumn = await this.resolveSeedWorkflowColumn(tx, projRecord);
      const seededTaskCount = await this.seedProjectTasksFromTemplate(
        tx,
        projRecord,
        creatorUser,
        template,
        seedColumn,
      );

      // e. Initial activity log
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
            memberCount: nonCreatorMembers.length + 1,
            seededTaskCount,
            seedWorkflowColumnId: seedColumn.id,
            seedWorkflowColumnName: seedColumn.name,
          },
        }),
      );

      return projRecord;
    });

    return this.toSerializer(await this.loadFull(project.id, organizationId));
  }

  // ---------------------------------------------------------------------------
  // Update project
  // ---------------------------------------------------------------------------

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
    requestUser: RequestUser,
  ): Promise<ProjectSerializer> {
    const { organizationId, id: userId } = requestUser;
    const actorUser = await this.userRepo.findOneOrFail({ where: { id: userId } });

    const projectWithAccess = await this.loadAuthorizedProject(
      projectId,
      requestUser,
      'update',
    );
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    this.ensureDateRange(
      dto.startDate ?? project.startDate,
      dto.endDate ?? project.endDate,
    );

    // Validate new template if provided
    if (dto.templateId && dto.templateId !== project.templateId) {
      const existingTaskCount = await this.taskRepo.count({
        where: { projectId, deletedAt: IsNull() },
      });
      if (existingTaskCount > 0) {
        throw new ConflictException(PROJECT_TEMPLATE_CHANGE_FORBIDDEN);
      }

      const newTemplate = await this.templateRepo.findOne({
        where: { id: dto.templateId, organizationId },
      });
      if (!newTemplate) throw new NotFoundException(TEMPLATE_NOT_IN_ORG);
      project.template  = newTemplate;
      project.templateId = dto.templateId;
    }

    // Validate new memberIds if provided
    let memberUsers: User[] = [];
    if (dto.memberIds !== undefined) {
      memberUsers = await this.userRepo.find({
        where: dto.memberIds.map((mid) => ({ id: mid, organizationId })),
      });
      if (memberUsers.length !== dto.memberIds.length) {
        throw new BadRequestException(MEMBER_NOT_IN_ORG);
      }
    }

    // Apply scalar updates
    if (dto.title       !== undefined) project.title       = dto.title;
    if (dto.description !== undefined) project.description = dto.description ?? null;
    if (dto.startDate   !== undefined) project.startDate   = dto.startDate ?? null;
    if (dto.endDate     !== undefined) project.endDate     = dto.endDate ?? null;
    if (dto.type        !== undefined) project.type        = dto.type;
    if (dto.status      !== undefined) {
      project.status = dto.status;
      project.archivedAt =
        dto.status === ProjectStatus.ARCHIVED
          ? project.archivedAt ?? new Date()
          : null;
    }

    await this.projectRepo.manager.transaction(async (tx) => {
      await tx.save(project);

      if (dto.memberIds !== undefined) {
        const projectRoles = await this.ensureDefaultProjectRoles(tx, project);
        const ownerRole = projectRoles.get('owner');
        const contributorRole = projectRoles.get('contributor');

        if (!ownerRole) {
          throw new NotFoundException(DEFAULT_PROJECT_ROLE_SETUP_FAILED);
        }

        if (!contributorRole) {
          throw new NotFoundException(DEFAULT_PROJECT_ROLE_NOT_FOUND);
        }

        // Load current ACTIVE memberships
        const existing = await tx.find(ProjectMembership, {
          where: { projectId, status: MembershipStatus.ACTIVE },
          relations: ['projectRole'],
        });

        const desiredIds = new Set(memberUsers.map((u) => u.id));
        const existingIds = new Set(existing.map((m) => m.userId));

        // Soft-remove members no longer desired (never remove OWNER)
        for (const membership of existing) {
          if (
            membership.projectRoleId !== ownerRole.id &&
            !desiredIds.has(membership.userId)
          ) {
            membership.status    = MembershipStatus.REMOVED;
            membership.removedAt = new Date();
            await tx.save(membership);

            await tx.save(
              tx.create(ProjectActivityLog, {
                project,
                projectId,
                user: actorUser,
                userId,
                taskId: null,
                actionType: ProjectActionType.MEMBER_REMOVED,
                actionMeta: { removedUserId: membership.userId },
              }),
            );
          }
        }

        // Add new members that don't already have an active membership
        for (const memberUser of memberUsers) {
          if (!existingIds.has(memberUser.id)) {
            const reloadedMember = await tx.findOneOrFail(User, {
              where: { pkid: memberUser.pkid },
            });
            await tx.save(
              tx.create(ProjectMembership, {
                project,
                projectId,
                user: reloadedMember,
                userId: reloadedMember.id,
                projectRole: contributorRole,
                projectRoleId: contributorRole.id,
                status: MembershipStatus.ACTIVE,
                invitedByUser: actorUser,
                invitedByUserId: userId,
                joinedAt: new Date(),
              }),
            );

            await tx.save(
              tx.create(ProjectActivityLog, {
                project,
                projectId,
                user: actorUser,
                userId,
                taskId: null,
                actionType: ProjectActionType.MEMBER_ADDED,
                actionMeta: { addedUserId: reloadedMember.id },
              }),
            );
          }
        }
      }

      if (dto.status !== undefined) {
        await tx.save(
          tx.create(ProjectActivityLog, {
            project,
            projectId,
            user: actorUser,
            userId,
            taskId: null,
            actionType: ProjectActionType.STATUS_CHANGED,
            actionMeta: {
              status: project.status,
              archivedAt: project.archivedAt,
            },
          }),
        );
      }

      // Activity log for the update
      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId,
          user: actorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_UPDATED,
          actionMeta: {
            updatedFields: Object.keys(dto).filter((k) => k !== 'memberIds'),
            activeMemberCount: projectWithAccess.memberships.filter(
              (membership) => membership.status === MembershipStatus.ACTIVE,
            ).length,
          },
        }),
      );
    });

    return this.toSerializer(await this.loadFull(projectId, organizationId));
  }

  // ---------------------------------------------------------------------------
  // Get one project
  // ---------------------------------------------------------------------------

  async getProject(
    projectId: string,
    requestUser: RequestUser,
  ): Promise<ProjectSerializer> {
    const { organizationId } = requestUser;

    const project = await this.loadFull(projectId, organizationId);

    await this.loadAuthorizedProject(projectId, requestUser, 'view');

    // Attach only the 20 most recent contribution logs
    const recentContributions = project.activityLogs.slice(0, 20);

    return this.toSerializer({ ...project, recentContributions } as unknown as Project);
  }

  // ---------------------------------------------------------------------------
  // Get all projects (paginated, membership-aware)
  // ---------------------------------------------------------------------------

  async getProjects(
    filters: ProjectFiltersDto,
    requestUser: RequestUser,
  ): Promise<FilterResponse<ProjectListItemSerializer>> {
    const { organizationId, id: userId } = requestUser;
    const { page, limit, search, type, status, templateId, orderBy, sortOrder } = filters;

    const qb = this.projectRepo
      .createQueryBuilder('p')
      .distinct(true)
      .leftJoinAndSelect('p.template', 'tpl')
      .leftJoinAndSelect('p.memberships', 'mem', 'mem.status = :activeStatus', {
        activeStatus: MembershipStatus.ACTIVE,
      })
      .where('p.organizationId = :orgId', { orgId: organizationId });

    // Project-role-aware visibility: non-admins only see projects where their
    // active membership grants projectManagement.view.
    if (!this.isAdmin(requestUser)) {
      qb.innerJoin(
        'p.memberships',
        'access_mem',
        'access_mem.userId = :userId AND access_mem.status = :memberStatus',
        { userId, memberStatus: MembershipStatus.ACTIVE },
      );
      qb.innerJoin('access_mem.projectRole', 'access_role');
      qb.andWhere('access_role.status = true');
      qb.andWhere(
        "COALESCE((access_role.permissions -> 'projectManagement' ->> 'view')::boolean, false) = true",
      );
    }

    // Optional filters
    if (type)       qb.andWhere('p.type = :type', { type });
    if (status)     qb.andWhere('p.status = :status', { status });
    if (templateId) qb.andWhere('p.templateId = :templateId', { templateId });
    if (search) {
      qb.andWhere('(p.title ILIKE :search OR p.description ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    // Ordering
    const col = orderBy && ['title', 'status', 'type', 'createdAt', 'updatedAt'].includes(orderBy)
      ? `p.${orderBy}`
      : 'p.createdAt';
    qb.orderBy(col, sortOrder ?? 'DESC');

    // Pagination
    qb.skip((page - 1) * limit).take(limit);

    const [data, count] = await qb.getManyAndCount();

    return {
      items: plainToInstance(ProjectListItemSerializer, data, {
        excludeExtraneousValues: true,
      }),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async deleteProject(
    projectId: string,
    requestUser: RequestUser,
  ): Promise<{ id: string; deleted: true }> {
    const project = await this.loadAuthorizedProject(projectId, requestUser, 'delete');

    await this.projectRepo.remove(project);

    return { id: projectId, deleted: true };
  }
}
