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
import { CreateUserDTO, UpdateMyProfileDto, UpdateUserDTO, UserSearchDto } from './dtos';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { EMAIL_EXISTS, USER_NOT_FOUND } from './messages';
import { UserSearchResultSerializer, UserSerializer } from './serializers';
import {
  WorkspaceMember,
  WorkspaceMemberStatus,
} from 'src/workspaces/entities/workspace-member.entity';
import { Workspace } from 'src/workspaces/entities/workspace.entity';

const ROLE_NOT_IN_WORKSPACE = 'Workspace role does not belong to this workspace';
const USER_NOT_IN_WORKSPACE = 'User not found in this workspace';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(WorkspaceMember)
    private readonly memberRepo: Repository<WorkspaceMember>,
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

  async getUser(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  private toSerializer(user: User): UserSerializer {
    return plainToInstance(UserSerializer, user, { excludeExtraneousValues: true });
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Admin creates a collaborator inside their workspace.
   * Creates the User, UserProfile, and WorkspaceMember records in a transaction.
   */
  async createUser(
    dto: CreateUserDTO,
    workspaceId: string,
    createdById: string,
  ): Promise<UserSerializer> {
    await this.ensureEmailFree(dto.email);

    const role = await this.roleService.getRole(dto.roleId);
    if (role.workspaceId !== workspaceId) {
      throw new BadRequestException(ROLE_NOT_IN_WORKSPACE);
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
        createdById,
      });
      const saved = await tx.save(newUser);

      await tx.save(
        tx.create(UserProfile, {
          userId: saved.id,
          profession: null,
          specialty: null,
          bio: null,
        }),
      );

      await tx.save(
        tx.create(WorkspaceMember, {
          workspaceId,
          userId: saved.id,
          workspaceRoleId: role.id,
          status: WorkspaceMemberStatus.ACTIVE,
          joinedAt: new Date(),
          invitedByUserId: createdById,
        }),
      );

      return saved;
    });

    return this.toSerializer(user);
  }

  async getUsers(
    filters: ListFilterDTO,
    workspaceId: string,
  ): Promise<FilterResponse<UserSerializer>> {
    // Join through workspace_members to scope users to this workspace.
    // Use the uuid columns ("userId", "workspaceId") — not the integer FK columns
    // (user_id, workspace_id) — to avoid integer = uuid type mismatch in Postgres.
    const qb = this.userRepo
      .createQueryBuilder('u')
      .innerJoin(
        WorkspaceMember,
        'wm',
        'wm."userId" = u.id AND wm."workspaceId" = :workspaceId AND wm.status = :status',
        { workspaceId, status: WorkspaceMemberStatus.ACTIVE },
      );

    const searchFields = ['u.firstName', 'u.lastName', 'u.userName', 'u.email'];

    if (filters.search) {
      const like = `%${filters.search}%`;
      qb.andWhere(
        '(' + searchFields.map((f) => `${f} ILIKE :search`).join(' OR ') + ')',
        { search: like },
      );
    }

    qb.orderBy('u.createdAt', 'DESC');

    const page  = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);

    const [data, count] = await qb.getManyAndCount();

    return {
      items: plainToInstance(UserSerializer, data, { excludeExtraneousValues: true }),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: count / limit > page ? page + 1 : null,
      limit,
    };
  }

  async getUserById(id: string, workspaceId: string): Promise<UserSerializer> {
    const member = await this.memberRepo.findOne({
      where: { userId: id, workspaceId, status: WorkspaceMemberStatus.ACTIVE },
      relations: ['user'],
    });
    if (!member) throw new NotFoundException(USER_NOT_IN_WORKSPACE);
    return this.toSerializer(member.user);
  }

  async updateUser(
    id: string,
    dto: UpdateUserDTO,
    workspaceId: string,
  ): Promise<UserSerializer> {
    // Verify user is a member of this workspace
    const member = await this.memberRepo.findOne({
      where: { userId: id, workspaceId, status: WorkspaceMemberStatus.ACTIVE },
    });
    if (!member) throw new NotFoundException(USER_NOT_IN_WORKSPACE);

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    if (dto.email && dto.email !== user.email)
      await this.ensureEmailFree(dto.email);

    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.userName !== undefined) user.userName = dto.userName;
    if (dto.title !== undefined) user.title = dto.title ?? null;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.status !== undefined) user.status = dto.status;

    // Role change → update workspace member record
    if (dto.roleId !== undefined) {
      const role = await this.roleService.getRole(dto.roleId);
      if (role.workspaceId !== workspaceId) {
        throw new BadRequestException(ROLE_NOT_IN_WORKSPACE);
      }
      member.workspaceRoleId = role.id;
      await this.memberRepo.save(member);
    }

    await this.userRepo.save(user);
    return this.toSerializer(user);
  }

  // ---------------------------------------------------------------------------
  // User search (cross-workspace, public profiles only)
  // ---------------------------------------------------------------------------

  /**
   * Searches for users whose profile is publicly discoverable.
   *
   * A user is discoverable when:
   *   - their own `isPublicProfile` flag is true, OR
   *   - their workspace has `allowPublicProfiles` set to true
   *
   * Results can optionally exclude users who are already active members
   * of a given project (via excludeProjectId).
   */
  async searchUsers(
    dto: UserSearchDto,
  ): Promise<{
    items: UserSearchResultSerializer[];
    count: number;
    page: number;
    pages: number;
    limit: number;
    previousPage: number | null;
    nextPage: number | null;
  }> {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const term  = `%${dto.q.trim().toLowerCase()}%`;

    const qb = this.userRepo
      .createQueryBuilder('u')
      .innerJoin(
        WorkspaceMember,
        'wm',
        'wm."userId" = u.id AND wm.status = :wmStatus',
        { wmStatus: WorkspaceMemberStatus.ACTIVE },
      )
      .innerJoin(Workspace, 'ws', 'ws.id = wm."workspaceId"')
      // Discoverability rule: own flag OR workspace flag
      .where('(u."isPublicProfile" = true OR ws."allowPublicProfiles" = true)')
      // Only active users
      .andWhere('u.status = true')
      // Search across name, username, email, workspace
      .andWhere(
        `(
          LOWER(u."firstName" || ' ' || u."lastName") LIKE :term
          OR LOWER(u."userName") LIKE :term
          OR LOWER(u.email) LIKE :term
          OR LOWER(ws.name) LIKE :term
          OR LOWER(ws.slug) LIKE :term
        )`,
        { term },
      )
      // Attach workspace data as virtual columns
      .addSelect('ws.id',   'ws_id')
      .addSelect('ws.name', 'ws_name')
      .addSelect('ws.slug', 'ws_slug')
      .orderBy('u.firstName', 'ASC')
      .addOrderBy('u.lastName', 'ASC');

    // Optionally exclude users who are already active members of a project
    if (dto.excludeProjectId) {
      qb.andWhere(
        `u.id NOT IN (
          SELECT pm."userId"
          FROM project_memberships pm
          WHERE pm."projectId" = :excludeProjectId
            AND pm.status = 'ACTIVE'
        )`,
        { excludeProjectId: dto.excludeProjectId },
      );
    }

    const countQb  = qb.clone();
    const total    = await countQb.getCount();
    const rawUsers = await qb.skip((page - 1) * limit).take(limit).getRawAndEntities();

    // Build result objects with the workspace snippet attached
    const items = rawUsers.entities.map((user, idx) => {
      const raw = rawUsers.raw[idx];
      return plainToInstance(
        UserSearchResultSerializer,
        {
          ...user,
          workspace: raw
            ? { id: raw.ws_id, name: raw.ws_name, slug: raw.ws_slug }
            : null,
        },
        { excludeExtraneousValues: true },
      );
    });

    return {
      items,
      count: total,
      pages: Math.ceil(total / limit),
      previousPage: page > 1 ? page - 1 : null,
      page,
      nextPage: total / limit > page ? page + 1 : null,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // My profile (self-service)
  // ---------------------------------------------------------------------------

  /**
   * Return the authenticated user's own record.
   */
  async getMyProfile(userId: string): Promise<UserSerializer> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return this.toSerializer(user);
  }

  /**
   * Let the authenticated user update their own profile fields, including
   * toggling isPublicProfile discoverability.
   */
  async updateMyProfile(
    userId: string,
    dto: UpdateMyProfileDto,
  ): Promise<UserSerializer> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    if (dto.firstName        !== undefined) user.firstName        = dto.firstName;
    if (dto.lastName         !== undefined) user.lastName         = dto.lastName;
    if (dto.userName         !== undefined) user.userName         = dto.userName;
    if (dto.title            !== undefined) user.title            = dto.title ?? null;
    if (dto.isPublicProfile  !== undefined) user.isPublicProfile  = dto.isPublicProfile;

    await this.userRepo.save(user);
    return this.toSerializer(user);
  }

  async adminResetPassword(
    id: string,
    newPassword: string,
    workspaceId: string,
  ): Promise<void> {
    const member = await this.memberRepo.findOne({
      where: { userId: id, workspaceId, status: WorkspaceMemberStatus.ACTIVE },
    });
    if (!member) throw new NotFoundException(USER_NOT_IN_WORKSPACE);

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    user.password          = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(12));
    user.isDefaultPassword = true;
    user.tokenVersion      = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);
  }
}
