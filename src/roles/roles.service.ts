import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { ListFilterDTO } from 'src/common/dtos';
import { FilterResponse } from 'src/common/interfaces';
import { FindManyOptions, Repository } from 'typeorm';
import { CreateRoleDTO, UpdateRoleDTO } from './dtos';
import { ROLE_EXISTS, ROLE_NOT_FOUND } from './messages';
import { WorkspaceRole } from './roles.entity';
import { RoleSerializer } from './serializers';
import { ListFilterService } from 'src/common/services/list-filter.service';
import { EMPTY_ACCESS_MATRIX, FULL_ACCESS_MATRIX } from './types/permission-matrix.type';
import type { PermissionMatrix } from './types/permission-matrix.type';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(WorkspaceRole) private readonly roleRepo: Repository<WorkspaceRole>,
    private readonly listFilterService: ListFilterService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureNameFree(name: string, workspaceId: string, excludeId?: string): Promise<void> {
    const existing = await this.roleRepo.findOne({
      where: { name: name.toLowerCase(), workspaceId },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(ROLE_EXISTS);
    }
  }

  // ---------------------------------------------------------------------------
  // Workspace role CRUD
  // ---------------------------------------------------------------------------

  async createRole(dto: CreateRoleDTO, workspaceId: string): Promise<RoleSerializer> {
    const name = dto.name.toLowerCase();
    const slug = name.replace(/\s+/g, '-');

    await this.ensureNameFree(name, workspaceId);

    // Merge provided permissions over an empty base to ensure all domains are present
    const permissions: PermissionMatrix = {
      ...EMPTY_ACCESS_MATRIX,
      ...(dto.permissions as unknown as PermissionMatrix),
    };

    const role = this.roleRepo.create({
      name,
      slug,
      status: true,
      isSystem: false,
      permissions,
      workspaceId,
    });

    const saved = await this.roleRepo.save(role);
    return plainToInstance(RoleSerializer, saved, { excludeExtraneousValues: true });
  }

  /** Load role by primary ID — used internally by guards / services. */
  async getRole(id: string): Promise<WorkspaceRole> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);
    return role;
  }

  async getRoleById(id: string, workspaceId: string): Promise<RoleSerializer> {
    const role = await this.roleRepo.findOne({ where: { id, workspaceId } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);
    return plainToInstance(RoleSerializer, role, { excludeExtraneousValues: true });
  }

  async getRoles(
    filters: ListFilterDTO,
    workspaceId: string,
  ): Promise<FilterResponse<RoleSerializer>> {
    const options: FindManyOptions<WorkspaceRole> = { where: { workspaceId } };

    return this.listFilterService.filter({
      repository: this.roleRepo,
      serializer: RoleSerializer,
      filters,
      searchFields: ['name'],
      options,
    });
  }

  async updateRole(
    id: string,
    dto: UpdateRoleDTO,
    workspaceId: string,
  ): Promise<RoleSerializer> {
    const role = await this.roleRepo.findOne({ where: { id, workspaceId } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);

    if (dto.name) {
      const name = dto.name.toLowerCase();
      await this.ensureNameFree(name, workspaceId, id);
      role.name = name;
      role.slug = name.replace(/\s+/g, '-');
    }

    if (dto.permissions) {
      role.permissions = {
        ...EMPTY_ACCESS_MATRIX,
        ...(dto.permissions as unknown as PermissionMatrix),
      };
    }

    const saved = await this.roleRepo.save(role);
    return plainToInstance(RoleSerializer, saved, { excludeExtraneousValues: true });
  }
}
