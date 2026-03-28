import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import {
  AUTH_CONFIG_KEY,
  BOOTSTRAP_CONFIG_KEY,
  authConfig,
  bootstrapConfig,
} from '../../config';
import {
  assertValidTimeZone,
  DEFAULT_TIMEZONE,
} from '../../common/utils/timezone.util';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserEntity } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { TeamMembershipEntity } from '../workspaces/entities/team-membership.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly workspaceMembershipsRepository: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(TeamMembershipEntity)
    private readonly teamMembershipsRepository: Repository<TeamMembershipEntity>,
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    private readonly configService: ConfigService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const email = this.normalizeEmail(createUserDto.email);
    const existingUser = await this.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await this.hashPassword(createUserDto.password);

    const user = this.usersRepository.create({
      email,
      name: this.normalizeName(createUserDto.name),
      role: createUserDto.role ?? UserRole.USER,
      passwordHash,
      timezone: DEFAULT_TIMEZONE,
    });

    const savedUser = await this.usersRepository.save(user);
    return this.toResponse(savedUser);
  }

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });

    return users.map((user) => this.toResponse(user));
  }

  async update(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.findOneOrFail(userId);
    const nextRole = dto.role ?? user.role;
    const nextIsActive = dto.isActive ?? user.isActive;

    await this.assertPlatformAdminRetention(user, nextRole, nextIsActive);
    this.assertSelfMutationAllowed(actor, user, nextRole, nextIsActive);

    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      const existingUser = await this.findByEmailCaseInsensitive(
        email,
        user.id,
      );

      if (existingUser) {
        throw new ConflictException('A user with this email already exists');
      }

      user.email = email;
    }

    if (dto.name !== undefined) {
      user.name = this.normalizeName(dto.name);
    }

    user.role = nextRole;
    user.isActive = nextIsActive;

    return this.toResponse(await this.usersRepository.save(user));
  }

  async delete(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ deleted: true; id: string }> {
    const user = await this.findOneOrFail(userId);
    const deletedUserId = user.id;

    await this.assertPlatformAdminRetention(user, UserRole.USER, false);
    this.assertSelfDeletionAllowed(actor, user);
    await this.assertDeletable(user);

    await this.usersRepository.remove(user);

    return {
      deleted: true,
      id: deletedUserId,
    };
  }

  async findOneOrFail(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User ${id} was not found`);
    }

    return user;
  }

  async updatePreferences(
    userId: string,
    dto: UpdateUserPreferencesDto,
  ): Promise<UserResponseDto> {
    const user = await this.findOneOrFail(userId);
    const timezone = assertValidTimeZone(dto.timezone);

    if (!timezone) {
      throw new BadRequestException('Timezone is required.');
    }

    if (user.timezone === timezone) {
      return this.toResponse(user);
    }

    user.timezone = timezone;
    return this.toResponse(await this.usersRepository.save(user));
  }

  async findByEmail(email: string) {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findByEmailWithPassword(email: string) {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async ensureDefaultAdmin() {
    const bootstrap =
      this.configService.getOrThrow<ConfigType<typeof bootstrapConfig>>(
        BOOTSTRAP_CONFIG_KEY,
      );

    if (!bootstrap.seedDefaultAdmin) {
      return;
    }

    const existingAdmin = await this.usersRepository.findOne({
      where: { email: bootstrap.adminEmail.toLowerCase() },
    });

    if (existingAdmin) {
      return;
    }

    const passwordHash = await this.hashPassword(bootstrap.adminPassword);

    const adminUser = this.usersRepository.create({
      email: bootstrap.adminEmail.toLowerCase(),
      name: bootstrap.adminName,
      role: UserRole.PLATFORM_ADMIN,
      passwordHash,
      timezone: DEFAULT_TIMEZONE,
    });

    await this.usersRepository.save(adminUser);
    this.logger.log(`Seeded default admin user: ${bootstrap.adminEmail}`);
  }

  toResponse(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      timezone: user.timezone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async hashPassword(password: string) {
    const auth =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );
    return bcrypt.hash(password, auth.bcryptSaltRounds);
  }

  private normalizeEmail(email: string) {
    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      throw new BadRequestException('Email is required.');
    }

    return normalized;
  }

  private normalizeName(name: string) {
    const normalized = name.trim();

    if (normalized.length < 2) {
      throw new BadRequestException('Name must be at least 2 characters.');
    }

    return normalized;
  }

  private async findByEmailCaseInsensitive(
    email: string,
    excludeUserId?: string,
  ) {
    const query = this.usersRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email });

    if (excludeUserId) {
      query.andWhere('user.id <> :excludeUserId', { excludeUserId });
    }

    return query.getOne();
  }

  private async assertDeletable(user: UserEntity) {
    const [
      workspaceMembershipCount,
      teamMembershipCount,
      ownedScheduledTaskCount,
    ] = await Promise.all([
      this.workspaceMembershipsRepository.count({
        where: { userId: user.id },
      }),
      this.teamMembershipsRepository.count({
        where: { userId: user.id },
      }),
      this.scheduledTasksRepository.count({
        where: { ownerUserId: user.id },
      }),
    ]);

    if (workspaceMembershipCount > 0) {
      throw new ConflictException(
        'Remove this user from all workspaces before deleting the account.',
      );
    }

    if (teamMembershipCount > 0) {
      throw new ConflictException(
        'Remove this user from all teams before deleting the account.',
      );
    }

    if (ownedScheduledTaskCount > 0) {
      throw new ConflictException(
        'Delete or reassign this user’s scheduled tasks before deleting the account.',
      );
    }
  }

  private async assertPlatformAdminRetention(
    user: UserEntity,
    nextRole: UserRole,
    nextIsActive: boolean,
  ) {
    if (
      user.role !== UserRole.PLATFORM_ADMIN ||
      !user.isActive ||
      (nextRole === UserRole.PLATFORM_ADMIN && nextIsActive)
    ) {
      return;
    }

    const activeAdminCount = await this.usersRepository.count({
      where: {
        role: UserRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });

    if (activeAdminCount <= 1) {
      throw new ConflictException(
        'At least one active platform admin must remain.',
      );
    }
  }

  private assertSelfMutationAllowed(
    actor: AuthenticatedUser,
    user: UserEntity,
    nextRole: UserRole,
    nextIsActive: boolean,
  ) {
    if (actor.id !== user.id) {
      return;
    }

    if (!nextIsActive) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    if (nextRole !== UserRole.PLATFORM_ADMIN) {
      throw new BadRequestException(
        'You cannot downgrade your own platform admin role.',
      );
    }
  }

  private assertSelfDeletionAllowed(
    actor: AuthenticatedUser,
    user: UserEntity,
  ) {
    if (actor.id === user.id) {
      throw new BadRequestException('You cannot delete your own account.');
    }
  }
}
