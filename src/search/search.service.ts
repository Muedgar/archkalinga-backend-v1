import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import type { RequestUser } from 'src/auth/types';
import { Project, ProjectMembership } from 'src/projects/entities';
import { MembershipStatus } from 'src/projects/entities/project-membership.entity';
import { Task, TaskAssignee } from 'src/tasks/entities';
import { User } from 'src/users/entities';
import type { WorkspaceMember } from 'src/workspaces/entities/workspace-member.entity';
import {
  SearchQueryDto,
  SearchResultType,
} from './dtos';
import { SearchRecentItem } from './entities';
import {
  SearchResponseSerializer,
  SearchResultItemSerializer,
} from './serializers';

interface ProjectSearchRow {
  project_id: string;
  project_title: string;
  project_description: string | null;
  project_status: string;
  project_type: string;
  project_updated_at: Date;
  matched_task_title: string | null;
  matched_user_name: string | null;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(SearchRecentItem)
    private readonly recentRepo: Repository<SearchRecentItem>,
  ) {}

  async search(
    dto: SearchQueryDto,
    requestUser: RequestUser,
    workspaceMember: WorkspaceMember,
  ): Promise<SearchResponseSerializer> {
    const query = dto.q?.trim();
    const limit = dto.limit ?? 8;

    if (!query) {
      return { items: [] };
    }

    const types = dto.types?.length ? dto.types : ['project'];
    if (!types.includes('project')) {
      return { items: [] };
    }

    const rows = await this.searchProjects(
      query,
      limit,
      requestUser.id,
      workspaceMember.workspaceId,
      dto.projectId,
    );

    return {
      items: rows.map((row) => this.toProjectResult(row, query)),
    };
  }

  async suggestions(
    dto: SearchQueryDto,
    requestUser: RequestUser,
    workspaceMember: WorkspaceMember,
  ): Promise<SearchResponseSerializer> {
    const query = dto.q?.trim();
    if (!query || query.length < 2) {
      return this.recent({ ...dto, limit: dto.limit ?? 6 }, requestUser, workspaceMember);
    }

    return this.search({ ...dto, limit: dto.limit ?? 6 }, requestUser, workspaceMember);
  }

  async recent(
    dto: SearchQueryDto,
    requestUser: RequestUser,
    workspaceMember: WorkspaceMember,
  ): Promise<SearchResponseSerializer> {
    const limit = dto.limit ?? 10;
    const recentRows = await this.recentRepo.find({
      where: {
        workspaceId: workspaceMember.workspaceId,
        userId: requestUser.id,
        type: 'project',
      },
      order: { openedAt: 'DESC' },
      take: limit,
    });

    if (!recentRows.length) {
      return { items: [] };
    }

    const projects = await this.loadAccessibleProjectsByIds(
      recentRows.map((row) => row.resourceId),
      requestUser.id,
      workspaceMember.workspaceId,
    );
    const projectById = new Map(projects.map((project) => [project.id, project]));

    return {
      items: recentRows
        .map((row) => {
          const project = projectById.get(row.resourceId);
          return project ? this.toRecentProjectResult(project, row.openedAt) : null;
        })
        .filter((item): item is SearchResultItemSerializer => item !== null),
    };
  }

  async recordRecent(
    type: SearchResultType,
    id: string,
    requestUser: RequestUser,
    workspaceMember: WorkspaceMember,
  ): Promise<{ type: SearchResultType; id: string }> {
    if (type !== 'project') {
      throw new BadRequestException('Only project search recents are supported');
    }

    await this.ensureProjectAccessible(id, requestUser.id, workspaceMember.workspaceId);

    const existing = await this.recentRepo.findOne({
      where: {
        workspaceId: workspaceMember.workspaceId,
        userId: requestUser.id,
        type,
        resourceId: id,
      },
    });
    const openedAt = new Date();

    await this.recentRepo.save({
      ...(existing ?? {}),
      workspaceId: workspaceMember.workspaceId,
      userId: requestUser.id,
      type,
      resourceId: id,
      openedAt,
    });

    return { type, id };
  }

  private async searchProjects(
    query: string,
    limit: number,
    userId: string,
    workspaceId: string,
    projectId?: string,
  ): Promise<ProjectSearchRow[]> {
    const like = `%${query}%`;

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .innerJoin(
        ProjectMembership,
        'accessMembership',
        [
          'accessMembership.projectId = project.id',
          'accessMembership.userId = :userId',
          'accessMembership.status = :memberStatus',
        ].join(' AND '),
        { userId, memberStatus: MembershipStatus.ACTIVE },
      )
      .innerJoin('accessMembership.projectRole', 'accessRole')
      .leftJoin(
        Task,
        'matchedTask',
        [
          'matchedTask.projectId = project.id',
          'matchedTask.deletedAt IS NULL',
          'matchedTask.title ILIKE :like',
        ].join(' AND '),
        { like },
      )
      .leftJoin(
        ProjectMembership,
        'matchedMembership',
        [
          'matchedMembership.projectId = project.id',
          'matchedMembership.status = :memberStatus',
        ].join(' AND '),
        { memberStatus: MembershipStatus.ACTIVE },
      )
      .leftJoin(
        User,
        'matchedProjectUser',
        [
          'matchedProjectUser.id = matchedMembership.userId',
          this.userNameSearchSql('matchedProjectUser'),
        ].join(' AND '),
        { like },
      )
      .leftJoin(
        TaskAssignee,
        'matchedTaskAssignee',
        'matchedTaskAssignee.taskId = matchedTask.id',
      )
      .leftJoin(
        User,
        'matchedTaskUser',
        [
          'matchedTaskUser.id = matchedTaskAssignee.userId',
          this.userNameSearchSql('matchedTaskUser'),
        ].join(' AND '),
        { like },
      )
      .where('project.workspaceId = :workspaceId', { workspaceId })
      .andWhere('accessRole.status = true');

    if (projectId) {
      qb.andWhere('project.id = :projectId', { projectId });
    }

    qb.andWhere(
      new Brackets((searchQb) => {
        searchQb
          .where('project.title ILIKE :like')
          .orWhere('project.description ILIKE :like')
          .orWhere('matchedTask.id IS NOT NULL')
          .orWhere('matchedProjectUser.id IS NOT NULL')
          .orWhere('matchedTaskUser.id IS NOT NULL');
      }),
    );

    qb
      .select('project.id', 'project_id')
      .addSelect('project.title', 'project_title')
      .addSelect('project.description', 'project_description')
      .addSelect('project.status', 'project_status')
      .addSelect('project.type', 'project_type')
      .addSelect('project.updatedAt', 'project_updated_at')
      .addSelect('MIN(matchedTask.title)', 'matched_task_title')
      .addSelect(
        `MIN(COALESCE(
          NULLIF(TRIM(matchedProjectUser."firstName" || ' ' || matchedProjectUser."lastName"), ''),
          NULLIF(TRIM(matchedTaskUser."firstName" || ' ' || matchedTaskUser."lastName"), '')
        ))`,
        'matched_user_name',
      )
      .groupBy('project.id')
      .addGroupBy('project.title')
      .addGroupBy('project.description')
      .addGroupBy('project.status')
      .addGroupBy('project.type')
      .addGroupBy('project.updatedAt')
      .orderBy(
        `MIN(CASE
          WHEN project.title ILIKE :like THEN 0
          WHEN matchedTask.id IS NOT NULL THEN 1
          WHEN matchedProjectUser.id IS NOT NULL OR matchedTaskUser.id IS NOT NULL THEN 2
          ELSE 3
        END)`,
        'ASC',
      )
      .addOrderBy('project.updatedAt', 'DESC')
      .limit(limit);

    return qb.getRawMany<ProjectSearchRow>();
  }

  private async ensureProjectAccessible(
    projectId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const count = await this.projectRepo
      .createQueryBuilder('project')
      .innerJoin(
        ProjectMembership,
        'accessMembership',
        [
          'accessMembership.projectId = project.id',
          'accessMembership.userId = :userId',
          'accessMembership.status = :memberStatus',
        ].join(' AND '),
        { userId, memberStatus: MembershipStatus.ACTIVE },
      )
      .innerJoin('accessMembership.projectRole', 'accessRole')
      .where('project.id = :projectId', { projectId })
      .andWhere('project.workspaceId = :workspaceId', { workspaceId })
      .andWhere('accessRole.status = true')
      .getCount();

    if (count === 0) {
      throw new ForbiddenException('Project access denied');
    }
  }

  private async loadAccessibleProjectsByIds(
    projectIds: string[],
    userId: string,
    workspaceId: string,
  ): Promise<Project[]> {
    return this.projectRepo
      .createQueryBuilder('project')
      .innerJoin(
        ProjectMembership,
        'accessMembership',
        [
          'accessMembership.projectId = project.id',
          'accessMembership.userId = :userId',
          'accessMembership.status = :memberStatus',
        ].join(' AND '),
        { userId, memberStatus: MembershipStatus.ACTIVE },
      )
      .innerJoin('accessMembership.projectRole', 'accessRole')
      .where('project.workspaceId = :workspaceId', { workspaceId })
      .andWhere('project.id IN (:...projectIds)', { projectIds })
      .andWhere('accessRole.status = true')
      .getMany();
  }

  private userNameSearchSql(alias: string): string {
    return `(
      ${alias}."firstName" ILIKE :like
      OR ${alias}."lastName" ILIKE :like
      OR ${alias}."userName" ILIKE :like
      OR ${alias}.email ILIKE :like
      OR (${alias}."firstName" || ' ' || ${alias}."lastName") ILIKE :like
    )`;
  }

  private toProjectResult(
    row: ProjectSearchRow,
    query: string,
  ): SearchResultItemSerializer {
    return {
      id: row.project_id,
      type: 'project',
      title: row.project_title,
      subtitle: `${row.project_type} · ${row.project_status}`,
      snippet: this.projectSnippet(row, query),
      href: `/projects/${row.project_id}`,
      projectId: row.project_id,
      icon: 'folder-kanban',
      score: this.projectScore(row, query),
      updatedAt: row.project_updated_at?.toISOString?.() ?? String(row.project_updated_at),
    };
  }

  private projectSnippet(row: ProjectSearchRow, query: string): string | undefined {
    if (this.matches(row.project_title, query)) return 'Project name match';
    if (this.matches(row.project_description, query)) return row.project_description ?? undefined;
    if (row.matched_task_title) return `Task match: ${row.matched_task_title}`;
    if (row.matched_user_name) return `Member match: ${row.matched_user_name}`;
    return undefined;
  }

  private projectScore(row: ProjectSearchRow, query: string): number {
    if (this.matches(row.project_title, query)) return 1;
    if (this.matches(row.project_description, query)) return 0.85;
    if (row.matched_task_title) return 0.75;
    if (row.matched_user_name) return 0.65;
    return 0.5;
  }

  private matches(value: string | null | undefined, query: string): boolean {
    return value?.toLowerCase().includes(query.toLowerCase()) ?? false;
  }

  private toRecentProjectResult(
    project: Project,
    openedAt: Date,
  ): SearchResultItemSerializer {
    return {
      id: project.id,
      type: 'project',
      title: project.title,
      subtitle: `${project.type} · ${project.status}`,
      snippet: 'Recently opened',
      href: `/projects/${project.id}`,
      projectId: project.id,
      icon: 'folder-kanban',
      score: 1,
      updatedAt: openedAt.toISOString(),
    };
  }
}
