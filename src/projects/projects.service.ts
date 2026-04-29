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
import { OutboxService } from 'src/outbox/outbox.service';

import { Workspace } from 'src/workspaces/entities/workspace.entity';
import { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import { Template, TemplateTask } from 'src/templates/entities';
import {
  Task,
  TaskActionType,
  TaskActivityLog,
} from 'src/tasks/entities';
import {
  ProjectStatus as ProjectStatusConfig,
  ProjectTaskType as ProjectTaskTypeConfig,
} from 'src/tasks/project-config';
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
  InviteStatus,
  ProjectInvite,
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
import { ProjectConfigService } from './project-config.service';

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
    @InjectRepository(ProjectInvite)
    private readonly inviteRepo: Repository<ProjectInvite>,
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ProjectStatusConfig)
    private readonly projectStatusRepo: Repository<ProjectStatusConfig>,
    @InjectRepository(ProjectTaskTypeConfig)
    private readonly projectTaskTypeRepo: Repository<ProjectTaskTypeConfig>,
    private readonly projectConfigService: ProjectConfigService,
    private readonly outboxService: OutboxService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isWorkspaceAdmin(workspaceMember: WorkspaceMember | undefined): boolean {
    return workspaceMember?.workspaceRole?.slug === 'admin';
  }

  private toSerializer(
    project: Project & Partial<ProjectDetail>,
  ): ProjectSerializer {
    return plainToInstance(ProjectSerializer, project, {
      excludeExtraneousValues: true,
    });
  }

  private ensureDateRange(
    startDate?: string | null,
    endDate?: string | null,
  ): void {
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

  private async loadProjectOrFail(projectId: string, workspaceId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, workspaceId },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  private async loadMembershipForUser(
    projectId: string,
    userId: string,
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<ProjectMembership | null> {
    if (prefetchedMembership !== undefined) return prefetchedMembership;

    return this.membershipRepo.findOne({
      where: {
        projectId,
        userId,
        status: MembershipStatus.ACTIVE,
      },
      relations: ['projectRole'],
    });
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
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<Project> {
    const projectPromise = this.loadProjectOrFail(projectId, workspaceId);
    const membershipPromise = this.isWorkspaceAdmin(workspaceMember)
      ? Promise.resolve<ProjectMembership | null>(null)
      : this.loadMembershipForUser(projectId, requestUser.id, prefetchedMembership);

    const [project, membership] = await Promise.all([
      projectPromise,
      membershipPromise,
    ]);

    if (!this.isWorkspaceAdmin(workspaceMember)) {
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
  ): Promise<string> {
    const lastSibling = await manager.findOne(Task, {
      where: {
        projectId,
        deletedAt: IsNull(),
        parentTaskId: parentTaskId ?? IsNull(),
        statusId: IsNull(),
      },
      order: { rank: 'DESC', createdAt: 'DESC' },
    });

    if (!lastSibling) return this.formatRankValue(RANK_STEP);
    const lastRank = this.parseRankValue(lastSibling.rank) ?? 0n;
    return this.formatRankValue(lastRank + RANK_STEP);
  }

  private async ensureDefaultProjectRoles(
    manager: EntityManager,
    project: Project,
  ): Promise<Map<string, ProjectRole>> {
    const existing = await manager.find(ProjectRole, { where: { projectId: project.id } });
    const roleMap = new Map(existing.map((role) => [role.slug, role]));

    // Build all missing roles as entities and batch-save in one round-trip
    const toCreate = DEFAULT_PROJECT_ROLE_DEFINITIONS
      .filter((def) => !roleMap.has(def.slug))
      .map((def) =>
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

    if (toCreate.length > 0) {
      const saved = await manager.save(toCreate);
      saved.forEach((role) => roleMap.set(role.slug, role));
    }

    return roleMap;
  }

  /**
   * Accumulates seeded-task activity log entities into the provided arrays.
   * Callers are responsible for batch-saving the arrays when seeding is complete.
   * This avoids 2 serial DB round-trips per task during template seeding.
   */
  private collectSeededTaskActivity(
    manager: EntityManager,
    project: Project,
    task: Task,
    actorUser: User,
    templateTaskId: string,
    taskLogs: TaskActivityLog[],
    projectLogs: ProjectActivityLog[],
  ): void {
    const actionMeta = {
      seededFromTemplate: true,
      templateTaskId,
      parentTaskId: task.parentTaskId,
    };

    taskLogs.push(
      manager.create(TaskActivityLog, {
        taskId: task.id,
        projectId: project.id,
        actorUser,
        actorUserId: actorUser.id,
        actionType: TaskActionType.TASK_CREATED,
        actionMeta,
      }),
    );

    projectLogs.push(
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
    templateTask: TemplateTaskNode,
    defaultStatusId: string,
    defaultTaskTypeId: string,
    parentTask: Task | null = null,
    rankCounters: Map<string | null, bigint>,
    taskLogs: TaskActivityLog[],
    projectLogs: ProjectActivityLog[],
  ): Promise<number> {
    // Compute rank in-memory — no DB query needed during batch seeding
    const parentKey = parentTask?.id ?? null;
    const prevRank = rankCounters.get(parentKey) ?? 0n;
    const nextRank = prevRank + RANK_STEP;
    rankCounters.set(parentKey, nextRank);
    const rank = this.formatRankValue(nextRank);

    const savedTask = await manager.save(
      manager.create(Task, {
        project,
        projectId: project.id,
        parent: parentTask,
        parentTaskId: parentTask?.id ?? null,
        statusId: defaultStatusId,
        taskTypeId: defaultTaskTypeId,
        priorityId: null,
        severityId: null,
        createdByUser: actorUser,
        createdByUserId: actorUser.id,
        title: templateTask.name.trim(),
        description: null,   // template tasks have text descriptions — not yet JSONB
        startDate: null,
        endDate: null,
        progress: null,
        completed: false,
        rank,
        deletedAt: null,
      }),
    );

    // Accumulate logs — batch-saved once when seeding is complete
    this.collectSeededTaskActivity(
      manager,
      project,
      savedTask,
      actorUser,
      templateTask.id,
      taskLogs,
      projectLogs,
    );

    let createdCount = 1;
    for (const child of templateTask.subtasks) {
      createdCount += await this.createProjectTaskFromTemplate(
        manager,
        project,
        actorUser,
        child,
        defaultStatusId,
        defaultTaskTypeId,
        savedTask,
        rankCounters,
        taskLogs,
        projectLogs,
      );
    }

    return createdCount;
  }

  private async seedProjectTasksFromTemplate(
    manager: EntityManager,
    project: Project,
    actorUser: User,
    template: Template,
  ): Promise<number> {
    // Fetch default status and task type seeded by ProjectConfigService.seedDefaults
    const [defaultStatus, defaultTaskType] = await Promise.all([
      this.projectStatusRepo.findOne({
        where: { projectId: project.id, isDefault: true },
      }),
      this.projectTaskTypeRepo.findOne({
        where: { projectId: project.id, isDefault: true },
      }),
    ]);

    if (!defaultStatus || !defaultTaskType) {
      // Config not seeded yet — skip template task creation gracefully
      return 0;
    }

    const templateTree = this.buildTemplateTaskTree(template.tasks ?? []);

    // In-memory rank counter (parentId → current rank bigint) eliminates one DB
    // query per task during seeding. Keys are parent task IDs (or null for roots).
    const rankCounters = new Map<string | null, bigint>();

    // Collect all activity log entities to batch-save after all tasks are created.
    // This replaces 2 serial INSERTs per task with a single batch INSERT at the end.
    const taskLogs: TaskActivityLog[] = [];
    const projectLogs: ProjectActivityLog[] = [];

    let createdCount = 0;
    for (const rootTask of templateTree) {
      createdCount += await this.createProjectTaskFromTemplate(
        manager,
        project,
        actorUser,
        rootTask,
        defaultStatus.id,
        defaultTaskType.id,
        null,
        rankCounters,
        taskLogs,
        projectLogs,
      );
    }

    // Batch-save all activity logs in two single INSERT statements
    if (taskLogs.length > 0)    await manager.save(TaskActivityLog, taskLogs);
    if (projectLogs.length > 0) await manager.save(ProjectActivityLog, projectLogs);

    return createdCount;
  }

  private async loadFull(projectId: string, workspaceId: string): Promise<Project> {
    // Keep GET /projects/:id intentionally lean: select only fields emitted by
    // ProjectSerializer, avoid relation Cartesian products, and avoid loading
    // removed members / non-pending invites that the response never exposes.
    const projectPromise = this.projectRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.template', 'template')
      .leftJoinAndSelect('p.projectRoles', 'projectRoles')
      .select([
        'p.pkid',
        'p.id',
        'p.workspaceId',
        'p.title',
        'p.description',
        'p.startDate',
        'p.endDate',
        'p.type',
        'p.status',
        'p.archivedAt',
        'p.createdByUserId',
        'p.createdAt',
        'p.updatedAt',
        'template.pkid',
        'template.id',
        'template.name',
        'template.description',
        'template.isDefault',
        'projectRoles.pkid',
        'projectRoles.id',
        'projectRoles.name',
        'projectRoles.slug',
        'projectRoles.status',
        'projectRoles.isSystem',
        'projectRoles.isProtected',
        'projectRoles.permissions',
        'projectRoles.createdAt',
      ])
      .where('p.id = :projectId', { projectId })
      .andWhere('p.workspaceId = :workspaceId', { workspaceId })
      .orderBy('projectRoles.createdAt', 'ASC')
      .getOne();

    const membershipsPromise = this.membershipRepo
      .createQueryBuilder('membership')
      .leftJoinAndSelect('membership.user', 'user')
      .leftJoinAndSelect('membership.projectRole', 'projectRole')
      .select([
        'membership.pkid',
        'membership.id',
        'membership.status',
        'membership.userId',
        'membership.projectRoleId',
        'membership.joinedAt',
        'user.pkid',
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.title',
        'projectRole.pkid',
        'projectRole.id',
        'projectRole.name',
        'projectRole.slug',
        'projectRole.status',
        'projectRole.isSystem',
        'projectRole.isProtected',
        'projectRole.permissions',
      ])
      .where('membership.projectId = :projectId', { projectId })
      .andWhere('membership.status = :status', { status: MembershipStatus.ACTIVE })
      .orderBy('membership.joinedAt', 'ASC')
      .getMany();

    const invitesPromise = this.inviteRepo
      .createQueryBuilder('invite')
      .leftJoinAndSelect('invite.projectRole', 'projectRole')
      .leftJoinAndSelect('invite.inviteeUser', 'inviteeUser')
      .select([
        'invite.pkid',
        'invite.id',
        'invite.status',
        'invite.expiresAt',
        'invite.message',
        'projectRole.pkid',
        'projectRole.id',
        'projectRole.name',
        'projectRole.slug',
        'projectRole.status',
        'projectRole.isSystem',
        'projectRole.isProtected',
        'projectRole.permissions',
        'inviteeUser.pkid',
        'inviteeUser.id',
        'inviteeUser.firstName',
        'inviteeUser.lastName',
        'inviteeUser.email',
        'inviteeUser.title',
      ])
      .where('invite.projectId = :projectId', { projectId })
      .andWhere('invite.status = :status', { status: InviteStatus.PENDING })
      .getMany();

    const activityLogsPromise = this.activityRepo
      .createQueryBuilder('activity')
      .leftJoinAndSelect('activity.user', 'user')
      .select([
        'activity.pkid',
        'activity.id',
        'activity.createdAt',
        'activity.userId',
        'activity.taskId',
        'activity.actionType',
        'user.pkid',
        'user.id',
        'user.firstName',
        'user.lastName',
      ])
      .where('activity.projectId = :projectId', { projectId })
      .orderBy('activity.createdAt', 'DESC')
      .take(20)
      .getMany();

    const [project, memberships, invites, activityLogs] = await Promise.all([
      projectPromise,
      membershipsPromise,
      invitesPromise,
      activityLogsPromise,
    ]);

    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    project.memberships  = memberships;
    project.invites      = invites;
    project.activityLogs = activityLogs;

    return project;
  }

  /**
   * Lightweight project load used immediately after createProject.
   * Skips activity logs entirely — the caller just created them and doesn't need
   * them in the creation response. The full log is available via getProject().
   */
  private async loadForCreate(projectId: string, workspaceId: string): Promise<Project> {
    // Same split strategy as loadFull — avoids Cartesian product from nested joins.
    // Skips invites and activityLogs entirely (not needed in the creation response).
    const [project, memberships] = await Promise.all([
      this.projectRepo.findOne({
        where: { id: projectId, workspaceId },
        relations: ['template', 'projectRoles'],
      }),
      this.membershipRepo.find({
        where: { projectId },
        relations: ['user', 'projectRole'],
        order: { joinedAt: 'ASC' },
      }),
    ]);

    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    project.memberships  = memberships;
    project.activityLogs = [];
    project.invites      = [];
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

    const [template, workspaceRecord, creatorUser] = await Promise.all([
      this.templateRepo.findOne({
        where: { id: dto.templateId, workspaceId },
        relations: ['tasks'],
        order: { tasks: { order: 'ASC' } },
      }),
      this.workspaceRepo.findOneOrFail({ where: { id: workspaceId } }),
      this.userRepo.findOneOrFail({ where: { id: userId } }),
    ]);
    if (!template) throw new NotFoundException(TEMPLATE_NOT_IN_WORKSPACE);

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

      const savedProj = await tx.save(proj);

      // Seed all default project roles (Owner, Manager, Contributor, Reviewer, Viewer)
      const projectRoles = await this.ensureDefaultProjectRoles(tx, savedProj);
      const ownerRole    = projectRoles.get(DEFAULT_OWNER_PROJECT_ROLE_SLUG);
      if (!ownerRole) throw new NotFoundException(DEFAULT_PROJECT_ROLE_SETUP_FAILED);

      // Creator is always the sole initial member with the Owner project role
      await tx.save(
        tx.create(ProjectMembership, {
          project: savedProj,
          projectId: savedProj.id,
          user: creatorUser,
          userId,
          projectRole: ownerRole,
          projectRoleId: ownerRole.id,
          status: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        }),
      );

      return savedProj;
    });

    // Seed all 5 config tables (statuses, priorities, severities, task types, labels).
    // Must run BEFORE template task seeding so tasks can reference a valid default status.
    await this.projectConfigService.seedDefaults(project);

    // Seed template tasks now that config defaults exist for the project.
    const seededTaskCount = await this.projectRepo.manager.transaction(async (tx) => {
      const count = await this.seedProjectTasksFromTemplate(
        tx,
        project,
        creatorUser,
        template,
      );

      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId: project.id,
          user: creatorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_CREATED,
          actionMeta: {
            title: dto.title,
            seededTaskCount: count,
          },
        }),
      );

      await this.outboxService.record(tx, {
        aggregateType: 'project',
        aggregateId: project.id,
        eventType: 'project.created',
        payload: {
          projectId: project.id,
          workspaceId,
          actorUserId: userId,
          title: dto.title,
          type: dto.type,
          templateId: dto.templateId,
          seededTaskCount: count,
        },
      });

      return count;
    });
    void seededTaskCount; // used for activity log above

    // Use a lean load — activity logs are not needed in the creation response
    // and loading them immediately would fetch all the seeded task logs back.
    return this.toSerializer(await this.loadForCreate(project.id, workspaceId));
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
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<ProjectSerializer> {
    const { id: userId } = requestUser;

    // Parallelize actor load + auth+project load — both independent of each other.
    // loadAuthorizedProject returns the project entity directly, so we use it for
    // the update instead of doing a second projectRepo.findOne (the old approach
    // was loading the project twice).
    const [actorUser, project] = await Promise.all([
      this.userRepo.findOneOrFail({ where: { id: userId } }),
      this.loadAuthorizedProject(
        projectId,
        workspaceId,
        requestUser,
        true,
        workspaceMember,
        prefetchedMembership,
      ),
    ]);

    this.ensureDateRange(
      dto.startDate ?? project.startDate,
      dto.endDate ?? project.endDate,
    );

    if (dto.templateId && dto.templateId !== project.templateId) {
      // Fire task count check + template lookup in parallel — both independent.
      // If tasks exist we throw immediately (the template result is discarded).
      const [existingTaskCount, newTemplate] = await Promise.all([
        this.taskRepo.count({ where: { projectId, deletedAt: IsNull() } }),
        this.templateRepo.findOne({ where: { id: dto.templateId, workspaceId } }),
      ]);
      if (existingTaskCount > 0) throw new ConflictException(PROJECT_TEMPLATE_CHANGE_FORBIDDEN);
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

    const activeMemberCountPromise = this.membershipRepo.count({
      where: { projectId, status: MembershipStatus.ACTIVE },
    });

    await this.projectRepo.manager.transaction(async (tx) => {
      await tx.save(project);
      const activeMemberCount = await activeMemberCountPromise;

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

      const updatedFields = Object.keys(dto);
      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId,
          user: actorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_UPDATED,
          actionMeta: {
            updatedFields,
            activeMemberCount,
          },
        }),
      );

      await this.outboxService.record(tx, {
        aggregateType: 'project',
        aggregateId: projectId,
        eventType: 'project.updated',
        payload: {
          projectId,
          workspaceId,
          actorUserId: userId,
          updatedFields,
          status: project.status,
        },
      });
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
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<ProjectSerializer> {
    if (!this.isWorkspaceAdmin(workspaceMember)) {
      const membership = await this.loadMembershipForUser(
        projectId,
        requestUser.id,
        prefetchedMembership,
      );
      if (!this.membershipIsActive(membership)) {
        throw new ForbiddenException(PROJECT_ACCESS_DENIED);
      }
    }

    const project = await this.loadFull(projectId, workspaceId);
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
      .leftJoinAndSelect('p.template', 'tpl')
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
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<{ id: string; deleted: true }> {
    const project = await this.loadAuthorizedProject(
      projectId,
      workspaceId,
      requestUser,
      true, // requiresManagement
      workspaceMember,
      prefetchedMembership,
    );
    const { id: actorId } = requestUser;
    // Wrap remove + outbox write in a single transaction so the event is
    // never lost even if hard-delete succeeds but the process crashes.
    await this.projectRepo.manager.transaction(async (tx) => {
      await tx.remove(project);
      await this.outboxService.record(tx, {
        aggregateType: 'project',
        aggregateId: projectId,
        eventType: 'project.deleted',
        payload: { projectId, workspaceId, actorUserId: actorId },
      });
    });
    return { id: projectId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // List active project members
  // ---------------------------------------------------------------------------

  async listMembers(
    projectId: string,
    requestUser: RequestUser,
    workspaceId: string,
    workspaceMember?: WorkspaceMember,
    prefetchedMembership?: ProjectMembership | null,
  ) {
    await this.loadAuthorizedProject(
      projectId,
      workspaceId,
      requestUser,
      false,
      workspaceMember,
      prefetchedMembership,
    );

    const memberships = await this.membershipRepo.find({
      where: { projectId, status: MembershipStatus.ACTIVE },
      relations: ['user', 'projectRole'],
      order: { joinedAt: 'ASC' },
    });

    return memberships.map((m) => ({
      userId: m.userId,
      projectRoleId: m.projectRoleId,
      joinedAt: m.joinedAt,
      firstName: m.user?.firstName ?? null,
      lastName: m.user?.lastName ?? null,
      email: m.user?.email ?? null,
      title: m.user?.title ?? null,
      projectRole: m.projectRole
        ? { id: m.projectRole.id, name: m.projectRole.name, slug: m.projectRole.slug }
        : null,
    }));
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
    prefetchedMembership?: ProjectMembership | null,
  ): Promise<ProjectSerializer> {
    const { id: userId } = requestUser;

    // Parallelize actor load + auth check — both independent of each other
    const [actorUser, project] = await Promise.all([
      this.userRepo.findOneOrFail({ where: { id: userId } }),
      this.loadAuthorizedProject(
        projectId,
        workspaceId,
        requestUser,
        true,
        workspaceMember,
        prefetchedMembership,
      ),
    ]);

    await this.projectRepo.manager.transaction(async (tx) => {
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

      await this.outboxService.record(tx, {
        aggregateType: 'project-member',
        aggregateId: memberId,
        eventType: 'project.member.role.updated',
        payload: {
          projectId,
          workspaceId,
          actorUserId: userId,
          memberId,
          projectRoleId: nextRole.id,
          projectRoleSlug: nextRole.slug,
        },
      });
    });

    return this.toSerializer(await this.loadFull(projectId, workspaceId));
  }
}
