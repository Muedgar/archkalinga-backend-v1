import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { ListFilterDTO } from 'src/common/dtos';
import { FilterResponse } from 'src/common/interfaces';
import { ListFilterService } from 'src/common/services/list-filter.service';
import { MembershipStatus } from './entities/project-membership.entity';
import { Project, ProjectInvite, ProjectMembership, ProjectRole } from './entities';
import {
  INVALID_PROJECT_ROLE_DISABLE,
  INVALID_PROJECT_ROLE_NAME,
  PROJECT_NOT_FOUND,
  PROJECT_ROLE_ALREADY_EXISTS,
  PROJECT_ROLE_DELETE_FORBIDDEN,
  PROJECT_ROLE_IN_USE,
  PROJECT_ROLE_NOT_FOUND,
} from './messages';
import { ProjectRoleSerializer } from './serializers/project-role.serializer';
import { UpdateProjectRoleDto } from './dtos/update-project-role.dto';
import { CreateProjectRoleDto } from './dtos/create-project-role.dto';
import {
  EMPTY_PROJECT_ACCESS_MATRIX,
  type ProjectPermissionMatrix,
} from './types/project-permission-matrix.type';

@Injectable()
export class ProjectRolesService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectRole)
    private readonly projectRoleRepo: Repository<ProjectRole>,
    @InjectRepository(ProjectMembership)
    private readonly membershipRepo: Repository<ProjectMembership>,
    @InjectRepository(ProjectInvite)
    private readonly inviteRepo: Repository<ProjectInvite>,
    private readonly listFilterService: ListFilterService,
  ) {}

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  private slugify(name: string): string {
    return this.normalizeName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  private toSerializer(role: ProjectRole): ProjectRoleSerializer {
    return plainToInstance(ProjectRoleSerializer, role, {
      excludeExtraneousValues: true,
    });
  }

  private async ensureProjectExists(projectId: string): Promise<Project> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  private async ensureRoleNameAndSlugAvailable(
    projectId: string,
    name: string,
    slug: string,
    excludeRoleId?: string,
  ): Promise<void> {
    const normalizedName = this.normalizeName(name).toLowerCase();

    const nameMatch = await this.projectRoleRepo
      .createQueryBuilder('role')
      .where('role.projectId = :projectId', { projectId })
      .andWhere('LOWER(role.name) = :name', { name: normalizedName })
      .getOne();

    if (nameMatch && nameMatch.id !== excludeRoleId) {
      throw new ConflictException(PROJECT_ROLE_ALREADY_EXISTS);
    }

    const slugMatch = await this.projectRoleRepo.findOne({
      where: { projectId, slug },
    });

    if (slugMatch && slugMatch.id !== excludeRoleId) {
      throw new ConflictException(PROJECT_ROLE_ALREADY_EXISTS);
    }
  }

  private async getProjectRole(projectId: string, roleId: string): Promise<ProjectRole> {
    const role = await this.projectRoleRepo.findOne({
      where: { id: roleId, projectId },
    });

    if (!role) throw new NotFoundException(PROJECT_ROLE_NOT_FOUND);
    return role;
  }

  private async ensureRoleNotInUse(role: ProjectRole): Promise<void> {
    const [membershipCount, inviteCount] = await Promise.all([
      this.membershipRepo.count({
        where: {
          projectId: role.projectId,
          projectRoleId: role.id,
          status: MembershipStatus.ACTIVE,
        },
      }),
      this.inviteRepo.count({
        where: {
          projectId: role.projectId,
          projectRoleId: role.id,
          status: 'PENDING' as ProjectInvite['status'],
        },
      }),
    ]);

    if (membershipCount > 0 || inviteCount > 0) {
      throw new BadRequestException(PROJECT_ROLE_IN_USE);
    }
  }

  private mergePermissions(
    permissions?: Record<string, boolean | Record<string, boolean>>,
  ): ProjectPermissionMatrix {
    return {
      ...EMPTY_PROJECT_ACCESS_MATRIX,
      ...(permissions as ProjectPermissionMatrix | undefined),
    };
  }

  async listProjectRoles(
    projectId: string,
    filters: ListFilterDTO,
  ): Promise<FilterResponse<ProjectRoleSerializer>> {
    await this.ensureProjectExists(projectId);

    return this.listFilterService.filter({
      repository: this.projectRoleRepo,
      serializer: ProjectRoleSerializer,
      filters,
      searchFields: ['name', 'slug'],
      options: {
        where: { projectId },
      },
    });
  }

  async getProjectRoleById(
    projectId: string,
    roleId: string,
  ): Promise<ProjectRoleSerializer> {
    await this.ensureProjectExists(projectId);
    const role = await this.getProjectRole(projectId, roleId);
    return this.toSerializer(role);
  }

  async createProjectRole(
    projectId: string,
    dto: CreateProjectRoleDto,
  ): Promise<ProjectRoleSerializer> {
    const project = await this.ensureProjectExists(projectId);

    const name = this.normalizeName(dto.name);
    const slug = this.slugify(name);
    if (!slug) {
      throw new BadRequestException(INVALID_PROJECT_ROLE_NAME);
    }

    await this.ensureRoleNameAndSlugAvailable(projectId, name, slug);

    const role = this.projectRoleRepo.create({
      project,       // relation object → populates project_id FK
      projectId,     // scalar accessor
      name,
      slug,
      status: true,
      isSystem: false,
      isProtected: false,
      permissions: this.mergePermissions(dto.permissions),
    });

    const saved = await this.projectRoleRepo.save(role);
    return this.toSerializer(saved);
  }

  async updateProjectRole(
    projectId: string,
    roleId: string,
    dto: UpdateProjectRoleDto,
  ): Promise<ProjectRoleSerializer> {
    await this.ensureProjectExists(projectId);
    const role = await this.getProjectRole(projectId, roleId);

    if (dto.name !== undefined) {
      const nextName = this.normalizeName(dto.name);
      const nextSlug = role.isSystem ? role.slug : this.slugify(nextName);
      if (!nextSlug) {
        throw new BadRequestException(INVALID_PROJECT_ROLE_NAME);
      }
      await this.ensureRoleNameAndSlugAvailable(projectId, nextName, nextSlug, role.id);
      role.name = nextName;
      if (!role.isSystem) {
        role.slug = nextSlug;
      }
    }

    if (dto.permissions) {
      role.permissions = this.mergePermissions(dto.permissions);
    }

    if (dto.status !== undefined) {
      if (role.isProtected && dto.status === false) {
        throw new BadRequestException(INVALID_PROJECT_ROLE_DISABLE);
      }

      if (dto.status === false) {
        await this.ensureRoleNotInUse(role);
      }

      role.status = dto.status;
    }

    const saved = await this.projectRoleRepo.save(role);
    return this.toSerializer(saved);
  }

  async deleteProjectRole(projectId: string, roleId: string): Promise<{ id: string }> {
    await this.ensureProjectExists(projectId);
    const role = await this.getProjectRole(projectId, roleId);

    if (role.isProtected) {
      throw new BadRequestException(PROJECT_ROLE_DELETE_FORBIDDEN);
    }

    await this.ensureRoleNotInUse(role);
    await this.projectRoleRepo.remove(role);

    return { id: roleId };
  }
}
