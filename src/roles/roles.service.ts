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
import { Role } from './roles.entity';
import { RoleSerializer } from './serializers';
import { ListFilterService } from 'src/common/services/list-filter.service';
import { EMPTY_ACCESS_MATRIX } from './types/permission-matrix.type';
import type { PermissionMatrix } from './types/permission-matrix.type';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    private readonly listFilterService: ListFilterService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureNameFree(
    name: string,
    organizationId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.roleRepo.findOne({
      where: { name: name.toLowerCase(), organizationId },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(ROLE_EXISTS);
    }
  }

  // ---------------------------------------------------------------------------
  // Workspace role CRUD
  // ---------------------------------------------------------------------------

  async createRole(
    dto: CreateRoleDTO,
    organizationId: string,
  ): Promise<RoleSerializer> {
    const name = dto.name.toLowerCase();
    const slug = name.replace(/\s+/g, '-');

    await this.ensureNameFree(name, organizationId);

    // Merge provided permissions over an empty base to ensure all domains present
    const permissions: PermissionMatrix = {
      ...EMPTY_ACCESS_MATRIX,
      ...(dto.permissions as unknown as PermissionMatrix),
    };

    const role = this.roleRepo.create({
      name,
      slug,
      status: true,
      permissions,
      organizationId,
    });

    const saved = await this.roleRepo.save(role);
    return plainToInstance(RoleSerializer, saved, {
      excludeExtraneousValues: true,
    });
  }

  async getRole(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);
    return role;
  }

  async getRoleById(
    id: string,
    organizationId: string,
  ): Promise<RoleSerializer> {
    const role = await this.roleRepo.findOne({ where: { id, organizationId } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);
    return plainToInstance(RoleSerializer, role, {
      excludeExtraneousValues: true,
    });
  }

  async getRoles(
    filters: ListFilterDTO,
    organizationId: string,
  ): Promise<FilterResponse<RoleSerializer>> {
    const options: FindManyOptions<Role> = { where: { organizationId } };

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
    organizationId: string,
  ): Promise<RoleSerializer> {
    const role = await this.roleRepo.findOne({ where: { id, organizationId } });
    if (!role) throw new NotFoundException(ROLE_NOT_FOUND);

    if (dto.name) {
      const name = dto.name.toLowerCase();
      await this.ensureNameFree(name, organizationId, id);
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
    return plainToInstance(RoleSerializer, saved, {
      excludeExtraneousValues: true,
    });
  }
}
