import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
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
  createOpaqueTokenLookupHash,
  issueOpaqueToken,
  verifyOpaqueToken,
} from '../../common/utils/opaque-token.util';
import {
  assertValidTimeZone,
  DEFAULT_TIMEZONE,
} from '../../common/utils/timezone.util';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import {
  PasswordResetTokenEntity,
  PasswordResetTokenStatus,
} from './entities/password-reset-token.entity';
import { UserEntity } from './entities/user.entity';
import {
  UserInvitationEntity,
  UserInvitationStatus,
} from './entities/user-invitation.entity';
import { UserRole } from './entities/user-role.enum';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { TeamMembershipEntity } from '../workspaces/entities/team-membership.entity';

const INVITATION_TTL_HOURS = 72;
const PASSWORD_RESET_TTL_HOURS = 1;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(UserInvitationEntity)
    private readonly userInvitationsRepository: Repository<UserInvitationEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly passwordResetTokensRepository: Repository<PasswordResetTokenEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly workspaceMembershipsRepository: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(TeamMembershipEntity)
    private readonly teamMembershipsRepository: Repository<TeamMembershipEntity>,
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    createUserDto: CreateUserDto,
  ): Promise<UserResponseDto> {
    const email = this.normalizeEmail(createUserDto.email);
    const existingUser = await this.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const createdUser = await this.usersRepository.manager.transaction(
      async (manager) => {
        const now = new Date();
        const user = manager.create(UserEntity, {
          email,
          name: this.normalizeName(createUserDto.name),
          role: createUserDto.role ?? UserRole.USER,
          passwordHash: null,
          timezone: DEFAULT_TIMEZONE,
          isActive: false,
          inviteStatus: UserInvitationStatus.PENDING,
          lastInvitedAt: now,
          activatedAt: null,
          criticalEventEmailsEnabled: true,
          enrollmentEmailsEnabled: true,
          sessionVersion: 0,
        });
        const savedUser = await manager.save(UserEntity, user);
        const invite = await this.createInvitationRecord(manager, {
          userId: savedUser.id,
          createdByUserId: actor.id,
          issuedAt: now,
        });

        await this.notificationsService.sendUserInvitation({
          email: savedUser.email,
          name: savedUser.name,
          token: invite.token,
          expiresAt: invite.expiresAt,
        });

        return savedUser;
      },
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'user.created',
      targetType: 'user',
      targetId: createdUser.id,
      targetLabel: createdUser.email,
      metadata: {
        role: createdUser.role,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return this.toResponse(createdUser);
  }

  async resendInvite(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ sent: true; userId: string; expiresAt: Date }> {
    const user = await this.findOneOrFail(userId);

    if (
      user.inviteStatus === UserInvitationStatus.ACCEPTED &&
      user.activatedAt
    ) {
      throw new ConflictException(
        'Only pending invited users can receive another invitation.',
      );
    }

    return this.usersRepository.manager.transaction(async (manager) => {
      const now = new Date();
      await manager.update(
        UserEntity,
        { id: user.id },
        {
          inviteStatus: UserInvitationStatus.PENDING,
          lastInvitedAt: now,
        },
      );
      const invite = await this.createInvitationRecord(manager, {
        userId: user.id,
        createdByUserId: actor.id,
        issuedAt: now,
      });

      await this.notificationsService.sendUserInvitation({
        email: user.email,
        name: user.name,
        token: invite.token,
        expiresAt: invite.expiresAt,
      });

      await this.auditLogsService.record({
        scope: 'platform',
        action: 'user.invitation.resent',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });

      return {
        sent: true as const,
        userId: user.id,
        expiresAt: invite.expiresAt,
      };
    });
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

    if (nextIsActive && user.inviteStatus !== UserInvitationStatus.ACCEPTED) {
      throw new ConflictException(
        'Pending invited users can only become active after accepting their invitation.',
      );
    }

    if (nextRole !== user.role || nextIsActive !== user.isActive) {
      user.sessionVersion += 1;
    }

    if (!nextIsActive) {
      user.isActive = false;
    } else {
      user.isActive = true;
      if (
        user.inviteStatus === UserInvitationStatus.ACCEPTED &&
        !user.activatedAt
      ) {
        user.activatedAt = new Date();
      }
    }

    user.role = nextRole;

    const saved = await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'user.updated',
      targetType: 'user',
      targetId: saved.id,
      targetLabel: saved.email,
      metadata: {
        role: saved.role,
        isActive: saved.isActive,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return this.toResponse(saved);
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

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'user.deleted',
      targetType: 'user',
      targetId: deletedUserId,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

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
    let changed = false;

    if (dto.timezone !== undefined) {
      const timezone = assertValidTimeZone(dto.timezone);

      if (!timezone) {
        throw new BadRequestException('Timezone is required.');
      }

      if (user.timezone !== timezone) {
        user.timezone = timezone;
        changed = true;
      }
    }

    if (
      dto.criticalEventEmailsEnabled !== undefined &&
      user.criticalEventEmailsEnabled !== dto.criticalEventEmailsEnabled
    ) {
      user.criticalEventEmailsEnabled = dto.criticalEventEmailsEnabled;
      changed = true;
    }

    if (
      dto.enrollmentEmailsEnabled !== undefined &&
      user.enrollmentEmailsEnabled !== dto.enrollmentEmailsEnabled
    ) {
      user.enrollmentEmailsEnabled = dto.enrollmentEmailsEnabled;
      changed = true;
    }

    if (!changed) {
      return this.toResponse(user);
    }

    const saved = await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'user.preferences.updated',
      targetType: 'user',
      targetId: saved.id,
      targetLabel: saved.email,
      metadata: {
        timezone: saved.timezone,
        criticalEventEmailsEnabled: saved.criticalEventEmailsEnabled,
        enrollmentEmailsEnabled: saved.enrollmentEmailsEnabled,
      },
      context: {
        actorType: 'user',
        actorUserId: saved.id,
        actorEmailSnapshot: saved.email,
      },
    });

    return this.toResponse(saved);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ success: true }> {
    const user = await this.findByIdWithPasswordOrFail(userId);

    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account must finish invitation activation before changing the password.',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.sessionVersion += 1;
    await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'user.password.changed',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
      },
    });

    return { success: true };
  }

  async getInvitationPreview(token: string): Promise<{
    email: string;
    name: string;
    expiresAt: Date;
  }> {
    const invitation = await this.findInvitationByTokenOrThrow(token);
    this.assertInvitationAvailable(invitation);

    const user = await this.findOneOrFail(invitation.userId);

    return {
      email: user.email,
      name: user.name,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    token: string,
    password: string,
  ): Promise<{ success: true }> {
    await this.usersRepository.manager.transaction(async (manager) => {
      const invitation = await this.findInvitationByTokenOrThrow(
        token,
        manager,
      );
      this.assertInvitationAvailable(invitation);
      const user = await manager.findOne(UserEntity, {
        where: { id: invitation.userId },
      });

      if (!user) {
        throw new NotFoundException(`User ${invitation.userId} was not found`);
      }

      if (
        user.inviteStatus === UserInvitationStatus.ACCEPTED &&
        user.activatedAt
      ) {
        throw new ConflictException('Invitation token has already been used.');
      }

      user.passwordHash = await this.hashPassword(password);
      user.isActive = true;
      user.inviteStatus = UserInvitationStatus.ACCEPTED;
      user.activatedAt = new Date();
      user.sessionVersion += 1;
      await manager.save(UserEntity, user);

      invitation.status = UserInvitationStatus.ACCEPTED;
      invitation.consumedAt = new Date();
      await manager.save(UserInvitationEntity, invitation);

      await this.revokePendingInvitations(manager, user.id, invitation.id);
    });

    return { success: true };
  }

  async requestPasswordReset(email: string): Promise<{ success: true }> {
    const user = await this.findByEmailWithPassword(email);

    if (
      !user ||
      !user.isActive ||
      user.inviteStatus !== UserInvitationStatus.ACCEPTED ||
      !user.passwordHash
    ) {
      return { success: true };
    }

    return this.usersRepository.manager.transaction(async (manager) => {
      const issuedAt = new Date();
      const resetToken = await this.createPasswordResetRecord(manager, {
        userId: user.id,
        issuedAt,
      });

      await this.notificationsService.sendPasswordReset({
        email: user.email,
        name: user.name,
        token: resetToken.token,
        expiresAt: resetToken.expiresAt,
      });

      return { success: true as const };
    });
  }

  async getPasswordResetPreview(token: string): Promise<{
    email: string;
    expiresAt: Date;
  }> {
    const resetToken = await this.findPasswordResetTokenOrThrow(token);
    this.assertPasswordResetAvailable(resetToken);

    const user = await this.findOneOrFail(resetToken.userId);

    return {
      email: user.email,
      expiresAt: resetToken.expiresAt,
    };
  }

  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ success: true }> {
    await this.usersRepository.manager.transaction(async (manager) => {
      const resetToken = await this.findPasswordResetTokenOrThrow(
        token,
        manager,
      );
      this.assertPasswordResetAvailable(resetToken);
      const user = await manager.findOne(UserEntity, {
        where: { id: resetToken.userId },
      });

      if (!user) {
        throw new NotFoundException(`User ${resetToken.userId} was not found`);
      }

      if (
        !user.isActive ||
        user.inviteStatus !== UserInvitationStatus.ACCEPTED
      ) {
        throw new ConflictException(
          'Only active accepted accounts can reset their password.',
        );
      }

      user.passwordHash = await this.hashPassword(password);
      user.sessionVersion += 1;
      await manager.save(UserEntity, user);

      resetToken.status = PasswordResetTokenStatus.USED;
      resetToken.consumedAt = new Date();
      await manager.save(PasswordResetTokenEntity, resetToken);

      await this.revokePendingPasswordResetTokens(
        manager,
        user.id,
        resetToken.id,
      );
    });

    return { success: true };
  }

  async findByEmail(email: string) {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase().trim() },
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
    const now = new Date();

    const adminUser = this.usersRepository.create({
      email: bootstrap.adminEmail.toLowerCase(),
      name: bootstrap.adminName,
      role: UserRole.PLATFORM_ADMIN,
      passwordHash,
      timezone: DEFAULT_TIMEZONE,
      isActive: true,
      inviteStatus: UserInvitationStatus.ACCEPTED,
      lastInvitedAt: null,
      activatedAt: now,
      criticalEventEmailsEnabled: true,
      enrollmentEmailsEnabled: true,
      sessionVersion: 0,
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
      inviteStatus: user.inviteStatus,
      lastInvitedAt: user.lastInvitedAt,
      activatedAt: user.activatedAt,
      criticalEventEmailsEnabled: user.criticalEventEmailsEnabled,
      enrollmentEmailsEnabled: user.enrollmentEmailsEnabled,
      mfaEnabled: user.mfaEnabled,
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

  private getSaltRounds() {
    const auth =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    return auth.bcryptSaltRounds;
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

  private async findByIdWithPasswordOrFail(
    userId: string,
  ): Promise<UserEntity> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException(`User ${userId} was not found`);
    }

    return user;
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

  private async createInvitationRecord(
    manager: Repository<UserEntity>['manager'],
    input: {
      userId: string;
      createdByUserId: string | null;
      issuedAt: Date;
    },
  ) {
    await this.revokePendingInvitations(manager, input.userId);

    const issuedToken = await issueOpaqueToken(this.getSaltRounds());
    const expiresAt = new Date(
      input.issuedAt.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000,
    );

    const invitation = manager.create(UserInvitationEntity, {
      userId: input.userId,
      createdByUserId: input.createdByUserId,
      tokenHash: issuedToken.tokenHash,
      tokenLookupHash: issuedToken.tokenLookupHash,
      status: UserInvitationStatus.PENDING,
      expiresAt,
      consumedAt: null,
      revokedAt: null,
    });

    await manager.save(UserInvitationEntity, invitation);

    return {
      token: issuedToken.token,
      expiresAt,
    };
  }

  private async createPasswordResetRecord(
    manager: Repository<UserEntity>['manager'],
    input: {
      userId: string;
      issuedAt: Date;
    },
  ) {
    await this.revokePendingPasswordResetTokens(manager, input.userId);

    const issuedToken = await issueOpaqueToken(this.getSaltRounds());
    const expiresAt = new Date(
      input.issuedAt.getTime() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000,
    );

    const resetToken = manager.create(PasswordResetTokenEntity, {
      userId: input.userId,
      tokenHash: issuedToken.tokenHash,
      tokenLookupHash: issuedToken.tokenLookupHash,
      status: PasswordResetTokenStatus.PENDING,
      expiresAt,
      consumedAt: null,
      revokedAt: null,
    });

    await manager.save(PasswordResetTokenEntity, resetToken);

    return {
      token: issuedToken.token,
      expiresAt,
    };
  }

  private async revokePendingInvitations(
    manager: Repository<UserEntity>['manager'],
    userId: string,
    excludeInvitationId?: string,
  ) {
    const invitations = await manager.find(UserInvitationEntity, {
      where: { userId, status: UserInvitationStatus.PENDING },
    });

    if (!invitations.length) {
      return;
    }

    for (const invitation of invitations) {
      if (excludeInvitationId && invitation.id === excludeInvitationId) {
        continue;
      }

      invitation.status = UserInvitationStatus.REVOKED;
      invitation.revokedAt = new Date();
    }

    await manager.save(UserInvitationEntity, invitations);
  }

  private async revokePendingPasswordResetTokens(
    manager: Repository<UserEntity>['manager'],
    userId: string,
    excludeTokenId?: string,
  ) {
    const tokens = await manager.find(PasswordResetTokenEntity, {
      where: { userId, status: PasswordResetTokenStatus.PENDING },
    });

    if (!tokens.length) {
      return;
    }

    for (const token of tokens) {
      if (excludeTokenId && token.id === excludeTokenId) {
        continue;
      }

      token.status = PasswordResetTokenStatus.REVOKED;
      token.revokedAt = new Date();
    }

    await manager.save(PasswordResetTokenEntity, tokens);
  }

  private async findInvitationByTokenOrThrow(
    token: string,
    manager?: Repository<UserEntity>['manager'],
  ): Promise<UserInvitationEntity> {
    const repository =
      manager?.getRepository(UserInvitationEntity) ??
      this.userInvitationsRepository;

    const candidate = await repository
      .createQueryBuilder('invitation')
      .addSelect('invitation.tokenHash')
      .addSelect('invitation.tokenLookupHash')
      .where('invitation.tokenLookupHash = :tokenLookupHash', {
        tokenLookupHash: createOpaqueTokenLookupHash(token),
      })
      .getOne();

    if (!candidate) {
      throw new NotFoundException('Invitation token was not found.');
    }

    const isValid = await verifyOpaqueToken({
      token,
      tokenHash: candidate.tokenHash,
      tokenLookupHash: candidate.tokenLookupHash,
    });

    if (!isValid) {
      throw new NotFoundException('Invitation token was not found.');
    }

    return candidate;
  }

  private async findPasswordResetTokenOrThrow(
    token: string,
    manager?: Repository<UserEntity>['manager'],
  ): Promise<PasswordResetTokenEntity> {
    const repository =
      manager?.getRepository(PasswordResetTokenEntity) ??
      this.passwordResetTokensRepository;
    const candidate = await repository
      .createQueryBuilder('reset')
      .addSelect('reset.tokenHash')
      .addSelect('reset.tokenLookupHash')
      .where('reset.tokenLookupHash = :tokenLookupHash', {
        tokenLookupHash: createOpaqueTokenLookupHash(token),
      })
      .getOne();

    if (!candidate) {
      throw new NotFoundException('Password reset token was not found.');
    }

    const isValid = await verifyOpaqueToken({
      token,
      tokenHash: candidate.tokenHash,
      tokenLookupHash: candidate.tokenLookupHash,
    });

    if (!isValid) {
      throw new NotFoundException('Password reset token was not found.');
    }

    return candidate;
  }

  private assertInvitationAvailable(invitation: UserInvitationEntity) {
    if (invitation.status === UserInvitationStatus.ACCEPTED) {
      throw new ConflictException('Invitation token has already been used.');
    }

    if (invitation.status === UserInvitationStatus.REVOKED) {
      throw new GoneException('Invitation token has expired or was revoked.');
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('Invitation token has expired or was revoked.');
    }
  }

  private assertPasswordResetAvailable(token: PasswordResetTokenEntity) {
    if (token.status === PasswordResetTokenStatus.USED) {
      throw new ConflictException(
        'Password reset token has already been used.',
      );
    }

    if (token.status === PasswordResetTokenStatus.REVOKED) {
      throw new GoneException(
        'Password reset token has expired or was revoked.',
      );
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(
        'Password reset token has expired or was revoked.',
      );
    }
  }
}
