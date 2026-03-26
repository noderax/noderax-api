import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  assertValidTimeZone,
  DEFAULT_TIMEZONE,
} from '../../common/utils/timezone.util';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UserEntity } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { UsersService } from '../users/users.service';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { computeNextScheduledRun } from '../tasks/scheduled-task.utils';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { CreateWorkspaceMemberDto } from './dto/create-workspace-member.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateWorkspaceMemberDto } from './dto/update-workspace-member.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { TeamMembershipEntity } from './entities/team-membership.entity';
import { TeamEntity } from './entities/team.entity';
import { WorkspaceMembershipEntity } from './entities/workspace-membership.entity';
import { WorkspaceMembershipRole } from './entities/workspace-membership-role.enum';
import { WorkspaceEntity } from './entities/workspace.entity';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspacesRepository: Repository<WorkspaceEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly membershipsRepository: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(TeamEntity)
    private readonly teamsRepository: Repository<TeamEntity>,
    @InjectRepository(TeamMembershipEntity)
    private readonly teamMembershipsRepository: Repository<TeamMembershipEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    private readonly usersService: UsersService,
  ) {}

  async findAccessibleWorkspaces(
    user: AuthenticatedUser,
  ): Promise<WorkspaceEntity[]> {
    if (user.role === UserRole.PLATFORM_ADMIN) {
      const workspaces = await this.workspacesRepository.find({
        order: { isDefault: 'DESC', isArchived: 'ASC', createdAt: 'ASC' },
      });

      return workspaces.map((workspace) => {
        workspace.currentUserRole = WorkspaceMembershipRole.OWNER;
        return workspace;
      });
    }

    const workspaces = await this.workspacesRepository
      .createQueryBuilder('workspace')
      .innerJoin(
        WorkspaceMembershipEntity,
        'membership',
        'membership."workspaceId" = workspace.id',
      )
      .where('membership."userId" = :userId', { userId: user.id })
      .orderBy('workspace."isDefault"', 'DESC')
      .addOrderBy('workspace."isArchived"', 'ASC')
      .addOrderBy('workspace."createdAt"', 'ASC')
      .getMany();

    if (!workspaces.length) {
      return [];
    }

    const memberships = await this.membershipsRepository.find({
      where: {
        userId: user.id,
        workspaceId: In(workspaces.map((workspace) => workspace.id)),
      },
    });
    const roleLookup = new Map(
      memberships.map(
        (membership) => [membership.workspaceId, membership.role] as const,
      ),
    );

    return workspaces.map((workspace) => {
      workspace.currentUserRole = roleLookup.get(workspace.id) ?? null;
      return workspace;
    });
  }

  async findWorkspaceOrFail(id: string): Promise<WorkspaceEntity> {
    const workspace = await this.workspacesRepository.findOne({
      where: { id },
    });

    if (!workspace) {
      throw new NotFoundException(`Workspace ${id} was not found`);
    }

    return workspace;
  }

  async findBySlugForUserOrFail(
    slug: string,
    user: AuthenticatedUser,
  ): Promise<WorkspaceEntity> {
    const workspace = await this.workspacesRepository.findOne({
      where: { slug },
    });

    if (!workspace) {
      throw new NotFoundException(`Workspace ${slug} was not found`);
    }

    return this.findWorkspaceForUserOrFail(workspace.id, user);
  }

  async findWorkspaceForUserOrFail(
    workspaceId: string,
    user: AuthenticatedUser,
  ): Promise<WorkspaceEntity> {
    const workspace = await this.findWorkspaceOrFail(workspaceId);

    if (user.role === UserRole.PLATFORM_ADMIN) {
      workspace.currentUserRole = WorkspaceMembershipRole.OWNER;
      return workspace;
    }

    const membership = await this.findMembershipForUser(workspaceId, user.id);
    if (!membership) {
      throw new ForbiddenException('You do not have access to this workspace.');
    }

    workspace.currentUserRole = membership.role;
    return workspace;
  }

  async findMembershipForUser(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipEntity | null> {
    return this.membershipsRepository.findOne({
      where: { workspaceId, userId },
    });
  }

  async createWorkspace(
    actor: AuthenticatedUser,
    dto: CreateWorkspaceDto,
  ): Promise<WorkspaceEntity> {
    this.assertPlatformAdmin(actor);
    const slug = this.normalizeSlug(dto.slug);
    const timezone = dto.defaultTimezone
      ? assertValidTimeZone(dto.defaultTimezone)
      : DEFAULT_TIMEZONE;
    const shouldBecomeDefault =
      dto.isDefault === true || !(await this.hasDefaultWorkspace());

    const existing = await this.workspacesRepository.findOne({
      where: { slug },
    });

    if (existing) {
      throw new ConflictException('A workspace with this slug already exists.');
    }

    const workspace = this.workspacesRepository.create({
      name: dto.name.trim(),
      slug,
      defaultTimezone: timezone,
      createdByUserId: actor.id,
      isArchived: dto.isArchived ?? false,
      isDefault: false,
    });
    const saved = await this.workspacesRepository.save(workspace);

    await this.membershipsRepository.save(
      this.membershipsRepository.create({
        workspaceId: saved.id,
        userId: actor.id,
        role: WorkspaceMembershipRole.OWNER,
      }),
    );

    if (shouldBecomeDefault) {
      await this.setDefaultWorkspace(saved.id);
      return this.findWorkspaceOrFail(saved.id);
    }

    return saved;
  }

  async updateWorkspace(
    workspaceId: string,
    actor: AuthenticatedUser,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceEntity> {
    const workspace = await this.findWorkspaceForUserOrFail(workspaceId, actor);
    await this.assertWorkspaceAdmin(workspaceId, actor);

    if (dto.isDefault !== undefined) {
      this.assertPlatformAdmin(actor);

      if (!dto.isDefault && workspace.isDefault) {
        throw new BadRequestException(
          'Default workspace cannot be unset directly. Select another workspace as default first.',
        );
      }
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) {
        throw new BadRequestException(
          'Workspace name must be at least 2 characters.',
        );
      }
      workspace.name = name;
    }

    if (dto.slug !== undefined) {
      const slug = this.normalizeSlug(dto.slug);
      const existing = await this.workspacesRepository.findOne({
        where: { slug },
      });

      if (existing && existing.id !== workspace.id) {
        throw new ConflictException(
          'A workspace with this slug already exists.',
        );
      }

      workspace.slug = slug;
    }

    if (dto.defaultTimezone !== undefined) {
      workspace.defaultTimezone = assertValidTimeZone(dto.defaultTimezone);
    }

    if (dto.isArchived !== undefined) {
      workspace.isArchived = dto.isArchived;
    }

    const saved = await this.workspacesRepository.save(workspace);

    if (dto.defaultTimezone !== undefined) {
      await this.recomputeWorkspaceSchedules(saved.id, saved.defaultTimezone);
    }

    if (dto.isDefault) {
      await this.setDefaultWorkspace(saved.id);
      return this.findWorkspaceOrFail(saved.id);
    }

    return saved;
  }

  async deleteWorkspace(
    workspaceId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string; slug: string }> {
    const workspace = await this.findWorkspaceForUserOrFail(workspaceId, actor);
    await this.assertWorkspaceAdmin(workspaceId, actor);

    if (workspace.isDefault) {
      throw new ConflictException(
        'Default workspace cannot be deleted. Select another default workspace first.',
      );
    }

    await this.workspacesRepository.remove(workspace);

    return {
      deleted: true,
      id: workspace.id,
      slug: workspace.slug,
    };
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMembershipEntity[]> {
    const memberships = await this.membershipsRepository.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });

    if (!memberships.length) {
      return memberships;
    }

    const users = await this.usersRepository.find({
      where: {
        id: In(memberships.map((membership) => membership.userId)),
      },
    });
    const userLookup = new Map(users.map((user) => [user.id, user]));

    return memberships.map((membership) => {
      const user = userLookup.get(membership.userId);
      membership.userName = user?.name ?? null;
      membership.userEmail = user?.email ?? null;
      return membership;
    });
  }

  async addMember(
    workspaceId: string,
    actor: AuthenticatedUser,
    dto: CreateWorkspaceMemberDto,
  ): Promise<WorkspaceMembershipEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);

    const email = dto.email.trim().toLowerCase();
    let user = await this.usersService.findByEmail(email);

    if (!user) {
      if (!dto.name?.trim() || !dto.password?.trim()) {
        throw new BadRequestException(
          'Name and password are required when creating a new global user.',
        );
      }

      const createUserDto: CreateUserDto = {
        email,
        name: dto.name.trim(),
        password: dto.password,
        role: UserRole.USER,
      };

      await this.usersService.create(createUserDto);
      user = await this.usersService.findByEmail(email);
    }

    if (!user) {
      throw new NotFoundException('User could not be created.');
    }

    const existing = await this.membershipsRepository.findOne({
      where: { workspaceId, userId: user.id },
    });

    if (existing) {
      throw new ConflictException(
        'This user is already a member of the workspace.',
      );
    }

    const membership = this.membershipsRepository.create({
      workspaceId,
      userId: user.id,
      role: dto.role,
    });
    const saved = await this.membershipsRepository.save(membership);
    saved.userName = user.name;
    saved.userEmail = user.email;
    return saved;
  }

  async updateMember(
    workspaceId: string,
    membershipId: string,
    actor: AuthenticatedUser,
    dto: UpdateWorkspaceMemberDto,
  ): Promise<WorkspaceMembershipEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    const membership = await this.membershipsRepository.findOne({
      where: { id: membershipId, workspaceId },
    });

    if (!membership) {
      throw new NotFoundException(
        `Workspace membership ${membershipId} was not found`,
      );
    }

    membership.role = dto.role;
    const saved = await this.membershipsRepository.save(membership);
    const user = await this.usersRepository.findOne({
      where: { id: membership.userId },
    });
    saved.userName = user?.name ?? null;
    saved.userEmail = user?.email ?? null;
    return saved;
  }

  async removeMember(
    workspaceId: string,
    membershipId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    const membership = await this.membershipsRepository.findOne({
      where: { id: membershipId, workspaceId },
    });

    if (!membership) {
      throw new NotFoundException(
        `Workspace membership ${membershipId} was not found`,
      );
    }

    await this.membershipsRepository.remove(membership);
    return {
      deleted: true,
      id: membershipId,
    };
  }

  async listTeams(workspaceId: string): Promise<TeamEntity[]> {
    return this.teamsRepository.find({
      where: { workspaceId },
      order: { createdAt: 'ASC' },
    });
  }

  async createTeam(
    workspaceId: string,
    actor: AuthenticatedUser,
    dto: CreateTeamDto,
  ): Promise<TeamEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    const team = this.teamsRepository.create({
      workspaceId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
    });

    return this.teamsRepository.save(team);
  }

  async updateTeam(
    workspaceId: string,
    teamId: string,
    actor: AuthenticatedUser,
    dto: UpdateTeamDto,
  ): Promise<TeamEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    const team = await this.teamsRepository.findOne({
      where: { id: teamId, workspaceId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${teamId} was not found`);
    }

    if (dto.name !== undefined) {
      team.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      team.description = dto.description?.trim() || null;
    }

    return this.teamsRepository.save(team);
  }

  async deleteTeam(
    workspaceId: string,
    teamId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    const team = await this.teamsRepository.findOne({
      where: { id: teamId, workspaceId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${teamId} was not found`);
    }

    await this.teamsRepository.remove(team);
    return {
      deleted: true,
      id: teamId,
    };
  }

  async listTeamMembers(
    workspaceId: string,
    teamId: string,
  ): Promise<TeamMembershipEntity[]> {
    await this.findTeamOrFail(workspaceId, teamId);
    const memberships = await this.teamMembershipsRepository.find({
      where: { teamId },
      order: { createdAt: 'ASC' },
    });

    if (!memberships.length) {
      return memberships;
    }

    const users = await this.usersRepository.find({
      where: {
        id: In(memberships.map((membership) => membership.userId)),
      },
    });
    const lookup = new Map(users.map((user) => [user.id, user]));

    return memberships.map((membership) => {
      const user = lookup.get(membership.userId);
      membership.userName = user?.name ?? null;
      membership.userEmail = user?.email ?? null;
      return membership;
    });
  }

  async addTeamMember(
    workspaceId: string,
    teamId: string,
    actor: AuthenticatedUser,
    dto: AddTeamMemberDto,
  ): Promise<TeamMembershipEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.findTeamOrFail(workspaceId, teamId);
    const workspaceMembership = await this.membershipsRepository.findOne({
      where: { workspaceId, userId: dto.userId },
    });

    if (!workspaceMembership) {
      throw new BadRequestException(
        'Only workspace members can be added to a team.',
      );
    }

    const membership = this.teamMembershipsRepository.create({
      teamId,
      userId: dto.userId,
    });
    const saved = await this.teamMembershipsRepository.save(membership);
    const user = await this.usersRepository.findOne({
      where: { id: dto.userId },
    });
    saved.userName = user?.name ?? null;
    saved.userEmail = user?.email ?? null;
    return saved;
  }

  async removeTeamMember(
    workspaceId: string,
    teamId: string,
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; userId: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.findTeamOrFail(workspaceId, teamId);
    const membership = await this.teamMembershipsRepository.findOne({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new NotFoundException(
        `Team membership for user ${userId} was not found`,
      );
    }

    await this.teamMembershipsRepository.remove(membership);
    return {
      deleted: true,
      userId,
    };
  }

  async getDefaultWorkspaceOrFail(): Promise<WorkspaceEntity> {
    const workspace = await this.workspacesRepository.findOne({
      where: [{ isDefault: true }, { slug: 'default' }],
      order: {
        isDefault: 'DESC',
        createdAt: 'ASC',
      },
    });

    if (!workspace) {
      throw new NotFoundException('Default workspace was not found.');
    }

    return workspace;
  }

  async assertWorkspaceAdmin(
    workspaceId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (actor.role === UserRole.PLATFORM_ADMIN) {
      return;
    }

    const membership = await this.membershipsRepository.findOne({
      where: { workspaceId, userId: actor.id },
    });

    if (
      !membership ||
      (membership.role !== WorkspaceMembershipRole.OWNER &&
        membership.role !== WorkspaceMembershipRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'Workspace owner or admin access is required.',
      );
    }
  }

  private async recomputeWorkspaceSchedules(
    workspaceId: string,
    timezone: string,
  ): Promise<void> {
    const schedules = await this.scheduledTasksRepository.find({
      where: {
        workspaceId,
        timezoneSource: 'workspace',
      },
      order: { createdAt: 'ASC' },
    });

    if (!schedules.length) {
      return;
    }

    const now = new Date();
    for (const schedule of schedules) {
      schedule.timezone = timezone;
      schedule.claimToken = null;
      schedule.claimedBy = null;
      schedule.leaseUntil = null;
      schedule.nextRunAt = schedule.enabled
        ? computeNextScheduledRun(schedule, now)
        : null;
    }

    await this.scheduledTasksRepository.save(schedules);
  }

  private async findTeamOrFail(
    workspaceId: string,
    teamId: string,
  ): Promise<TeamEntity> {
    const team = await this.teamsRepository.findOne({
      where: { id: teamId, workspaceId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${teamId} was not found`);
    }

    return team;
  }

  private assertPlatformAdmin(user: AuthenticatedUser): void {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException('Platform admin access is required.');
    }
  }

  private async hasDefaultWorkspace(): Promise<boolean> {
    const workspace = await this.workspacesRepository.findOne({
      where: { isDefault: true },
      select: ['id'],
    });

    return Boolean(workspace);
  }

  private async setDefaultWorkspace(workspaceId: string): Promise<void> {
    await this.workspacesRepository.manager.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(WorkspaceEntity)
        .set({ isDefault: false })
        .where('"isDefault" = true')
        .execute();

      await manager
        .createQueryBuilder()
        .update(WorkspaceEntity)
        .set({ isDefault: true })
        .where('"id" = :workspaceId', { workspaceId })
        .execute();
    });
  }

  private normalizeSlug(value: string): string {
    const slug = value.trim().toLowerCase();
    if (!slug.length) {
      throw new BadRequestException('Workspace slug is required.');
    }
    return slug;
  }
}
