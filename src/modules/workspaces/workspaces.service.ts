import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { assertValidTimeZone, DEFAULT_TIMEZONE } from '../../common/utils/timezone.util';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventEntity } from '../events/entities/event.entity';
import { NodeEntity } from '../nodes/entities/node.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { UserInvitationStatus } from '../users/entities/user-invitation.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { computeNextScheduledRun } from '../tasks/scheduled-task.utils';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { AssignableUserDto } from './dto/assignable-user.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { CreateWorkspaceMemberDto } from './dto/create-workspace-member.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceSearchResponseDto } from './dto/workspace-search-response.dto';
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
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(EventEntity)
    private readonly eventsRepository: Repository<EventEntity>,
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    private readonly auditLogsService: AuditLogsService,
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
      automationEmailEnabled: dto.automationEmailEnabled ?? false,
      automationTelegramEnabled: dto.automationTelegramEnabled ?? false,
      automationTelegramBotToken: dto.automationTelegramBotToken ?? null,
      automationTelegramChatId: dto.automationTelegramChatId ?? null,
      automationEmailLevels: dto.automationEmailLevels ?? [EventSeverity.CRITICAL],
      automationTelegramLevels: dto.automationTelegramLevels ?? [EventSeverity.CRITICAL],
    });
    const saved = await this.workspacesRepository.save(workspace);

    await this.membershipsRepository.save(
      this.membershipsRepository.create({
        workspaceId: saved.id,
        userId: actor.id,
        role: WorkspaceMembershipRole.OWNER,
      }),
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: saved.id,
      targetLabel: saved.name,
      metadata: {
        slug: saved.slug,
        defaultTimezone: saved.defaultTimezone,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

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
    const before = {
      name: workspace.name,
      slug: workspace.slug,
      defaultTimezone: workspace.defaultTimezone,
      isArchived: workspace.isArchived,
      isDefault: workspace.isDefault,
    };

    if (workspace.isArchived && !this.isUnarchiveOnlyRequest(dto)) {
      throw new ConflictException(
        'Archived workspaces are read-only. Restore the workspace before changing settings.',
      );
    }

    if (dto.isDefault !== undefined) {
      this.assertPlatformAdmin(actor);

      if (!dto.isDefault && workspace.isDefault) {
        throw new BadRequestException(
          'Default workspace cannot be unset directly. Select another workspace as default first.',
        );
      }
    }

    if (dto.isArchived === true && workspace.isDefault) {
      throw new ConflictException(
        'Default workspace cannot be archived. Select another default workspace first.',
      );
    }

    if (
      dto.isDefault === true &&
      (workspace.isArchived || dto.isArchived === true)
    ) {
      throw new ConflictException(
        'Archived workspaces cannot become the default workspace.',
      );
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
 
     if (dto.automationEmailEnabled !== undefined) {
       workspace.automationEmailEnabled = dto.automationEmailEnabled;
     }
 
     if (dto.automationTelegramEnabled !== undefined) {
       workspace.automationTelegramEnabled = dto.automationTelegramEnabled;
     }
 
     if (dto.automationTelegramBotToken !== undefined) {
       workspace.automationTelegramBotToken = dto.automationTelegramBotToken;
     }
 
     if (dto.automationTelegramChatId !== undefined) {
       workspace.automationTelegramChatId = dto.automationTelegramChatId;
     }
 
     if (dto.automationEmailLevels !== undefined) {
       workspace.automationEmailLevels = dto.automationEmailLevels;
     }
 
     if (dto.automationTelegramLevels !== undefined) {
       workspace.automationTelegramLevels = dto.automationTelegramLevels;
     }

    const saved = await this.workspacesRepository.save(workspace);

    if (dto.defaultTimezone !== undefined) {
      await this.recomputeWorkspaceSchedules(saved.id, saved.defaultTimezone);
    }

    if (dto.isDefault) {
      await this.setDefaultWorkspace(saved.id);
      const defaultedWorkspace = await this.findWorkspaceOrFail(saved.id);
      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId: saved.id,
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: saved.id,
        targetLabel: saved.name,
        changes: {
          before,
          after: {
            name: defaultedWorkspace.name,
            slug: defaultedWorkspace.slug,
            defaultTimezone: defaultedWorkspace.defaultTimezone,
            isArchived: defaultedWorkspace.isArchived,
            isDefault: defaultedWorkspace.isDefault,
          },
        },
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });
      return defaultedWorkspace;
    }

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.id,
      action: 'workspace.updated',
      targetType: 'workspace',
      targetId: saved.id,
      targetLabel: saved.name,
      changes: {
        before,
        after: {
          name: saved.name,
          slug: saved.slug,
          defaultTimezone: saved.defaultTimezone,
          isArchived: saved.isArchived,
          isDefault: saved.isDefault,
        },
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return saved;
  }

  async deleteWorkspace(
    workspaceId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string; slug: string }> {
    const workspace = await this.findWorkspaceForUserOrFail(workspaceId, actor);
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);

    if (workspace.isDefault) {
      throw new ConflictException(
        'Default workspace cannot be deleted. Select another default workspace first.',
      );
    }

    await this.workspacesRepository.remove(workspace);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: workspace.id,
      action: 'workspace.deleted',
      targetType: 'workspace',
      targetId: workspace.id,
      targetLabel: workspace.name,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

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
      membership.userIsActive = user?.isActive ?? null;
      return membership;
    });
  }

  async listAssignableUsers(
    workspaceId: string,
    actor: AuthenticatedUser,
  ): Promise<AssignableUserDto[]> {
    await this.assertWorkspaceAdmin(workspaceId, actor);

    const memberships = await this.membershipsRepository.find({
      where: { workspaceId },
      select: ['userId'],
    });
    const memberIds = new Set(
      memberships.map((membership) => membership.userId),
    );
    const users = await this.usersRepository.find({
      where: {
        isActive: true,
        inviteStatus: UserInvitationStatus.ACCEPTED,
      },
      order: {
        name: 'ASC',
        email: 'ASC',
      },
    });

    return users
      .filter((user) => !memberIds.has(user.id))
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      }));
  }

  async addMember(
    workspaceId: string,
    actor: AuthenticatedUser,
    dto: CreateWorkspaceMemberDto,
  ): Promise<WorkspaceMembershipEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);
    const user = await this.usersRepository.findOne({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${dto.userId} was not found.`);
    }

    if (!user.isActive || user.inviteStatus !== UserInvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'Only active accepted users can be added to a workspace.',
      );
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
    saved.userIsActive = user.isActive;

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'workspace.member.added',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      metadata: {
        role: saved.role,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });
    return saved;
  }

  async updateMember(
    workspaceId: string,
    membershipId: string,
    actor: AuthenticatedUser,
    dto: UpdateWorkspaceMemberDto,
  ): Promise<WorkspaceMembershipEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);
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
    saved.userIsActive = user?.isActive ?? null;

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'workspace.member.updated',
      targetType: 'user',
      targetId: membership.userId,
      targetLabel: user?.email ?? membership.userId,
      metadata: {
        role: saved.role,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });
    return saved;
  }

  async removeMember(
    workspaceId: string,
    membershipId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);

    await this.workspacesRepository.manager.transaction(async (manager) => {
      const membership = await manager.findOne(WorkspaceMembershipEntity, {
        where: { id: membershipId, workspaceId },
      });

      if (!membership) {
        throw new NotFoundException(
          `Workspace membership ${membershipId} was not found`,
        );
      }

      const teams = await manager.find(TeamEntity, {
        where: { workspaceId },
        select: ['id'],
      });

      if (teams.length > 0) {
        await manager.delete(TeamMembershipEntity, {
          userId: membership.userId,
          teamId: In(teams.map((team) => team.id)),
        });
      }

      await manager.remove(WorkspaceMembershipEntity, membership);
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'workspace.member.removed',
      targetType: 'workspace_membership',
      targetId: membershipId,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

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
    await this.assertWorkspaceWritable(workspaceId);
    const team = this.teamsRepository.create({
      workspaceId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
    });

    const saved = await this.teamsRepository.save(team);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'team.created',
      targetType: 'team',
      targetId: saved.id,
      targetLabel: saved.name,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return saved;
  }

  async updateTeam(
    workspaceId: string,
    teamId: string,
    actor: AuthenticatedUser,
    dto: UpdateTeamDto,
  ): Promise<TeamEntity> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);
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

    const saved = await this.teamsRepository.save(team);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'team.updated',
      targetType: 'team',
      targetId: saved.id,
      targetLabel: saved.name,
      metadata: {
        description: saved.description,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return saved;
  }

  async deleteTeam(
    workspaceId: string,
    teamId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; id: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);
    const team = await this.teamsRepository.findOne({
      where: { id: teamId, workspaceId },
    });

    if (!team) {
      throw new NotFoundException(`Team ${teamId} was not found`);
    }

    const [assignedNodeCount, targetedScheduleCount] = await Promise.all([
      this.nodesRepository.count({
        where: { workspaceId, teamId },
      }),
      this.scheduledTasksRepository.count({
        where: { workspaceId, targetTeamId: teamId },
      }),
    ]);

    if (assignedNodeCount > 0) {
      throw new BadRequestException(
        'Reassign or clear team-owned nodes before deleting this team.',
      );
    }

    if (targetedScheduleCount > 0) {
      throw new BadRequestException(
        'Delete or retarget team schedules before deleting this team.',
      );
    }

    await this.teamsRepository.remove(team);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'team.deleted',
      targetType: 'team',
      targetId: team.id,
      targetLabel: team.name,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });
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
      membership.userIsActive = user?.isActive ?? null;
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
    await this.assertWorkspaceWritable(workspaceId);
    await this.findTeamOrFail(workspaceId, teamId);
    const workspaceMembership = await this.membershipsRepository.findOne({
      where: { workspaceId, userId: dto.userId },
    });

    if (!workspaceMembership) {
      throw new BadRequestException(
        'Only workspace members can be added to a team.',
      );
    }

    const user = await this.usersRepository.findOne({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${dto.userId} was not found.`);
    }

    if (!user.isActive || user.inviteStatus !== UserInvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'Only active workspace members can be added to a team.',
      );
    }

    const existingMembership = await this.teamMembershipsRepository.findOne({
      where: { teamId, userId: dto.userId },
    });

    if (existingMembership) {
      throw new ConflictException('This user is already a member of the team.');
    }

    const membership = this.teamMembershipsRepository.create({
      teamId,
      userId: dto.userId,
    });
    const saved = await this.teamMembershipsRepository.save(membership);
    saved.userName = user.name;
    saved.userEmail = user.email;
    saved.userIsActive = user.isActive;

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'team.member.added',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      metadata: {
        teamId,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });
    return saved;
  }

  async removeTeamMember(
    workspaceId: string,
    teamId: string,
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<{ deleted: true; userId: string }> {
    await this.assertWorkspaceAdmin(workspaceId, actor);
    await this.assertWorkspaceWritable(workspaceId);
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

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'team.member.removed',
      targetType: 'user',
      targetId: userId,
      metadata: {
        teamId,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });
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

  async assertWorkspaceWritable(workspaceId: string): Promise<WorkspaceEntity> {
    const workspace = await this.findWorkspaceOrFail(workspaceId);

    if (workspace.isArchived) {
      throw new ConflictException(
        'Archived workspaces are read-only. Restore the workspace before making changes.',
      );
    }

    return workspace;
  }

  async searchWorkspace(
    workspaceId: string,
    query: string | undefined,
    limit = 5,
  ): Promise<WorkspaceSearchResponseDto> {
    const normalizedQuery = query?.trim();

    if (!normalizedQuery) {
      return {
        nodes: [],
        tasks: [],
        scheduledTasks: [],
        events: [],
        members: [],
        teams: [],
      };
    }

    const search = `%${normalizedQuery}%`;
    const safeLimit = Math.min(Math.max(limit, 1), 10);

    const [nodes, tasks, scheduledTasks, events, members, teams] =
      await Promise.all([
        this.nodesRepository
          .createQueryBuilder('node')
          .select('node.id', 'id')
          .addSelect('node.name', 'title')
          .addSelect(
            `CONCAT(node.hostname, ' · ', node.os, '/', node.arch)`,
            'subtitle',
          )
          .where('node.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            '(node.name ILIKE :search OR node.hostname ILIKE :search OR node.os ILIKE :search OR node.arch ILIKE :search)',
            { search },
          )
          .orderBy('node.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
        this.tasksRepository
          .createQueryBuilder('task')
          .leftJoin(NodeEntity, 'node', 'node.id = task.nodeId')
          .select('task.id', 'id')
          .addSelect(
            `COALESCE(task.payload->>'title', task.payload->>'name', task.payload->>'label', task.payload->>'command', task.type)`,
            'title',
          )
          .addSelect(
            `CONCAT(CAST(task.status AS text), ' · ', COALESCE(node.name, CAST(task."nodeId" AS text)))`,
            'subtitle',
          )
          .where('task.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            `(task.type ILIKE :search
              OR CAST(task.status AS text) ILIKE :search
              OR COALESCE(task.payload->>'title', '') ILIKE :search
              OR COALESCE(task.payload->>'name', '') ILIKE :search
              OR COALESCE(task.payload->>'label', '') ILIKE :search
              OR COALESCE(task.payload->>'command', '') ILIKE :search
              OR COALESCE(node.name, '') ILIKE :search)`,
            { search },
          )
          .orderBy('task.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
        this.scheduledTasksRepository
          .createQueryBuilder('schedule')
          .leftJoin(NodeEntity, 'node', 'node.id = schedule.nodeId')
          .select('schedule.id', 'id')
          .addSelect('schedule.name', 'title')
          .addSelect(
            `CONCAT(CASE WHEN schedule.enabled THEN 'enabled' ELSE 'disabled' END, ' · ', COALESCE(node.name, CAST(schedule."nodeId" AS text)))`,
            'subtitle',
          )
          .where('schedule.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            "(schedule.name ILIKE :search OR schedule.command ILIKE :search OR COALESCE(node.name, '') ILIKE :search)",
            { search },
          )
          .orderBy('schedule.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
        this.eventsRepository
          .createQueryBuilder('event')
          .select('event.id', 'id')
          .addSelect('event.type', 'title')
          .addSelect(`CONCAT(event.severity, ' · ', event.message)`, 'subtitle')
          .where('event.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            '(event.type ILIKE :search OR CAST(event.severity AS text) ILIKE :search OR event.message ILIKE :search)',
            { search },
          )
          .orderBy('event.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
        this.membershipsRepository
          .createQueryBuilder('membership')
          .innerJoin(UserEntity, 'user', 'user.id = membership.userId')
          .select('membership.id', 'id')
          .addSelect('user.name', 'title')
          .addSelect(`CONCAT(user.email, ' · ', membership.role)`, 'subtitle')
          .where('membership.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            '(user.name ILIKE :search OR user.email ILIKE :search OR CAST(membership.role AS text) ILIKE :search)',
            { search },
          )
          .orderBy('membership.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
        this.teamsRepository
          .createQueryBuilder('team')
          .select('team.id', 'id')
          .addSelect('team.name', 'title')
          .addSelect('team.description', 'subtitle')
          .where('team.workspaceId = :workspaceId', { workspaceId })
          .andWhere(
            "(team.name ILIKE :search OR COALESCE(team.description, '') ILIKE :search)",
            {
              search,
            },
          )
          .orderBy('team.createdAt', 'DESC')
          .limit(safeLimit)
          .getRawMany(),
      ]);

    return {
      nodes,
      tasks,
      scheduledTasks,
      events,
      members,
      teams,
    };
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

  async findTeamOrFail(
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

  private isUnarchiveOnlyRequest(dto: UpdateWorkspaceDto): boolean {
    const definedEntries = Object.entries(dto).filter(
      ([, value]) => value !== undefined,
    );

    return (
      definedEntries.length === 1 &&
      definedEntries[0][0] === 'isArchived' &&
      definedEntries[0][1] === false
    );
  }
}
