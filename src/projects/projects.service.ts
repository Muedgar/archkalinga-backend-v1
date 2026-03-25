import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { In, Repository } from 'typeorm';

import { Organization } from 'src/organizations/entities/organization.entity';
import { Template } from 'src/templates/entities/template.entity';
import { User } from 'src/users/entities/user.entity';
import { RequestUser } from 'src/auth/types';

import { CreateProjectDto, UpdateProjectDto, ProjectFiltersDto } from './dtos';
import {
  MEMBER_NOT_IN_ORG,
  PROJECT_ACCESS_DENIED,
  PROJECT_NOT_FOUND,
  TEMPLATE_NOT_IN_ORG,
} from './messages';
import {
  Project,
  ProjectActivityLog,
  ProjectActionType,
  ProjectMembership,
  ProjectStatus,
} from './entities';
import { MembershipRole, MembershipStatus } from './entities/project-membership.entity';
import { ProjectSerializer, ProjectListItemSerializer } from './serializers';
import { FilterResponse } from 'src/common/interfaces';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectDetail {
  project: Project;
  memberships: ProjectMembership[];
  invites: never[];          // placeholder — invite endpoints come in a later module
  recentContributions: ProjectActivityLog[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectActivityLog)
    private readonly activityRepo: Repository<ProjectActivityLog>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
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

  /** Load the full project with all relations needed for detail/response views. */
  private async loadFull(projectId: string, organizationId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
      relations: [
        'template',
        'template.phases',
        'memberships',
        'memberships.user',
        'activityLogs',
        'activityLogs.user',
      ],
      order: {
        template: { phases: { order: 'ASC' } },
        activityLogs: { createdAt: 'DESC' },
      },
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

    // 1. Validate template belongs to same org
    const template = await this.templateRepo.findOne({
      where: { id: dto.templateId, organizationId },
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

      // b. Creator membership (OWNER)
      await tx.save(
        tx.create(ProjectMembership, {
          project: projRecord,
          projectId: projRecord.id,
          user: creatorUser,
          userId,
          role: MembershipRole.OWNER,
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
            role: MembershipRole.MEMBER,
            status: MembershipStatus.ACTIVE,
            invitedByUser: creatorUser,
            invitedByUserId: userId,
            joinedAt: new Date(),
          }),
        );
      }

      // d. Initial activity log
      await tx.save(
        tx.create(ProjectActivityLog, {
          project: projRecord,
          projectId: projRecord.id,
          user: creatorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_CREATED,
          actionMeta: { title: dto.title, memberCount: nonCreatorMembers.length + 1 },
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

    // Load project — org check built in
    const project = await this.projectRepo.findOne({
      where: { id: projectId, organizationId },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);

    // Validate new template if provided
    if (dto.templateId && dto.templateId !== project.templateId) {
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
      project.status     = dto.status;
      project.archivedAt = dto.status === ProjectStatus.ARCHIVED ? new Date() : project.archivedAt;
    }

    const actorUser = await this.userRepo.findOneOrFail({ where: { id: userId } });

    await this.projectRepo.manager.transaction(async (tx) => {
      await tx.save(project);

      if (dto.memberIds !== undefined) {
        // Load current ACTIVE memberships
        const existing = await tx.find(ProjectMembership, {
          where: { projectId, status: MembershipStatus.ACTIVE },
        });

        const desiredIds = new Set(memberUsers.map((u) => u.id));
        const existingIds = new Set(existing.map((m) => m.userId));

        // Soft-remove members no longer desired (never remove OWNER)
        for (const membership of existing) {
          if (
            membership.role !== MembershipRole.OWNER &&
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
                role: MembershipRole.MEMBER,
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

      // Activity log for the update
      await tx.save(
        tx.create(ProjectActivityLog, {
          project,
          projectId,
          user: actorUser,
          userId,
          taskId: null,
          actionType: ProjectActionType.PROJECT_UPDATED,
          actionMeta: { updatedFields: Object.keys(dto).filter((k) => k !== 'memberIds') },
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
    const { organizationId, id: userId } = requestUser;

    const project = await this.loadFull(projectId, organizationId);

    // Visibility: admin sees all; others need active membership
    if (!this.isAdmin(requestUser)) {
      const isMember = project.memberships.some(
        (m) => m.userId === userId && m.status === MembershipStatus.ACTIVE,
      );
      if (!isMember) throw new ForbiddenException(PROJECT_ACCESS_DENIED);
    }

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
      .leftJoinAndSelect('p.template', 'tpl')
      .leftJoinAndSelect('p.memberships', 'mem', 'mem.status = :activeStatus', {
        activeStatus: MembershipStatus.ACTIVE,
      })
      .where('p.organizationId = :orgId', { orgId: organizationId });

    // Membership-aware visibility: non-admins only see projects they belong to
    if (!this.isAdmin(requestUser)) {
      qb.innerJoin(
        'p.memberships',
        'access_mem',
        'access_mem.userId = :userId AND access_mem.status = :memberStatus',
        { userId, memberStatus: MembershipStatus.ACTIVE },
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
}
