import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { ListFilterDTO } from 'src/common/dtos';
import { FilterResponse } from 'src/common/interfaces';
import { ListFilterService } from 'src/common/services';
import { RoleService } from 'src/roles/roles.service';
import { FindManyOptions, Repository } from 'typeorm';
import { CreateUserDTO, UpdateUserDTO } from './dtos';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { EMAIL_EXISTS, USER_NOT_FOUND } from './messages';
import { UserSerializer } from './serializers';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    private readonly roleService: RoleService,
    private readonly listFilterService: ListFilterService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensureEmailFree(email: string): Promise<void> {
    const exists = await this.userRepo.findOne({ where: { email } });
    if (exists) throw new ConflictException(EMAIL_EXISTS);
  }

  /** Load a user with full relations for API responses. */
  private async loadFull(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['organization', 'role'],
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  // ---------------------------------------------------------------------------
  // Used by auth guards / strategies
  // ---------------------------------------------------------------------------

  async getUser(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Admin creates a collaborator inside their own organization.
   * The new user is set with isDefaultPassword = true so the frontend can
   * prompt them to change it on first login.
   */
  async createUser(
    dto: CreateUserDTO,
    organizationId: string,
    createdById: string,
  ): Promise<UserSerializer> {
    await this.ensureEmailFree(dto.email);

    const role = await this.roleService.getRole(dto.roleId);
    // Enforce the workspace role belongs to the same organization
    if (role.organizationId !== organizationId) {
      throw new BadRequestException(
        'Workspace role does not belong to your organization',
      );
    }

    const hashedPassword = bcrypt.hashSync(
      dto.password,
      bcrypt.genSaltSync(12),
    );

    const user = await this.userRepo.manager.transaction(async (tx) => {
      const newUser = tx.create(User, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        userName: dto.userName,
        email: dto.email,
        title: dto.title ?? null,
        password: hashedPassword,
        status: dto.status,
        isDefaultPassword: true,
        twoFactorAuthentication: false,
        emailVerified: false,
        organizationId,
        roleId: role.id,
        createdById,
      });

      const saved = await tx.save(newUser);

      await tx.save(
        tx.create(UserProfile, {
          userId: saved.id,
          profession: null,
          specialty: null,
          bio: null,
          organizationName: null,
          organizationWebsite: null,
          teamSize: null,
        }),
      );

      return saved;
    });

    const full = await this.loadFull(user.id);
    return plainToInstance(UserSerializer, full, {
      excludeExtraneousValues: true,
    });
  }

  async getUsers(
    filters: ListFilterDTO,
    organizationId: string,
  ): Promise<FilterResponse<UserSerializer>> {
    const searchFields = ['firstName', 'lastName', 'userName', 'email'];
    const options: FindManyOptions<User> = {
      where: { organizationId },
      relations: ['organization', 'role'],
    };

    return this.listFilterService.filter({
      repository: this.userRepo,
      serializer: UserSerializer,
      filters,
      searchFields,
      options,
    });
  }

  async getUserById(
    id: string,
    organizationId: string,
  ): Promise<UserSerializer> {
    const user = await this.userRepo.findOne({
      where: { id, organizationId },
      relations: ['organization', 'role'],
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return plainToInstance(UserSerializer, user, {
      excludeExtraneousValues: true,
    });
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    organizationId: string,
  ): Promise<UserSerializer> {
    const user = await this.userRepo.findOne({ where: { id, organizationId } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    if (dto.email && dto.email !== user.email)
      await this.ensureEmailFree(dto.email);

    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.userName !== undefined) user.userName = dto.userName;
    if (dto.title !== undefined) user.title = dto.title ?? null;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.status !== undefined) user.status = dto.status;

    if (dto.roleId !== undefined) {
      const role = await this.roleService.getRole(dto.roleId);
      if (role.organizationId !== organizationId) {
        throw new BadRequestException(
          'Workspace role does not belong to your organization',
        );
      }
      user.roleId = role.id;
    }

    await this.userRepo.save(user);
    const full = await this.loadFull(user.id);
    return plainToInstance(UserSerializer, full, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Admin resets another user's password.
   * Sets isDefaultPassword = true so the frontend prompts a change on next login.
   */
  async adminResetPassword(
    id: string,
    newPassword: string,
    organizationId: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id, organizationId } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    user.password = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(12));
    user.isDefaultPassword = true;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);
  }
}
