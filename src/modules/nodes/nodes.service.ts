import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { UpdateNodeNotificationsDto } from './dto/update-node-notifications.dto';
import { UpdateNodeRootAccessDto } from './dto/update-node-root-access.dto';
import { NodeEntity } from './entities/node.entity';
import {
  buildNodeLocationDto,
  resolveNodeLocationFields,
  type NodeLocationFields,
  type NodeLocationInput,
} from './node-location.util';
import {
  NODE_ROOT_ACCESS_PROFILES,
  NodeRootAccessProfile,
} from './entities/node-root-access-profile.enum';
import { NodeRootAccessSyncStatus } from './entities/node-root-access-sync-status.enum';
import { NodeStatus } from './entities/node-status.enum';

type NodeRootAccessSurface = 'operational' | 'task' | 'terminal';

type NodeRootAccessSyncReport = {
  appliedProfile?: NodeRootAccessProfile | null;
  lastAppliedAt?: string | null;
  lastError?: string | null;
};

const DEFAULT_NODE_NOTIFICATION_LEVELS = [
  EventSeverity.INFO,
  EventSeverity.WARNING,
  EventSeverity.CRITICAL,
];
const AGENT_TOKEN_ROTATION_PENDING_MS = 5 * 60 * 1000;
const ROOT_ACCESS_MIN_DURATION_MINUTES = 5;
const ROOT_ACCESS_DEFAULT_MAX_DURATION_MINUTES = 120;

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    private readonly configService: ConfigService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
    private readonly workspacesService: WorkspacesService,
    private readonly auditLogsService: AuditLogsService,
    @Optional()
    private readonly outboxService?: OutboxService,
  ) {}

  async create(
    createNodeDto: CreateNodeDto,
    workspaceId?: string,
  ): Promise<NodeEntity> {
    await this.assertHostnameAvailable(createNodeDto.hostname);
    const workspace = workspaceId
      ? await this.workspacesService.assertWorkspaceWritable(workspaceId)
      : await this.workspacesService.assertWorkspaceWritable(
          (await this.workspacesService.getDefaultWorkspaceOrFail()).id,
        );
    const team = createNodeDto.teamId
      ? await this.workspacesService.findTeamOrFail(
          workspace.id,
          createNodeDto.teamId,
        )
      : null;

    const node = this.nodesRepository.create({
      workspaceId: workspace.id,
      name: createNodeDto.name ?? createNodeDto.hostname,
      description: createNodeDto.description ?? null,
      hostname: createNodeDto.hostname,
      os: createNodeDto.os,
      arch: createNodeDto.arch,
      status: NodeStatus.OFFLINE,
      teamId: team?.id ?? null,
      maintenanceMode: false,
      notificationEmailEnabled: true,
      notificationEmailLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
      rootAccessExpiresAt: null,
      rootAccessReason: null,
      rootAccessGrantedByUserId: null,
      rootAccessGrantId: null,
      rootAccessLastAppliedAt: null,
      rootAccessLastError: null,
      maintenanceReason: null,
      maintenanceStartedAt: null,
      maintenanceByUserId: null,
      agentVersion: null,
      platformVersion: null,
      kernelVersion: null,
      lastVersionReportedAt: null,
    });

    return this.populateTeamMetadata(await this.nodesRepository.save(node));
  }

  async findAll(
    query: QueryNodesDto,
    workspaceId?: string,
  ): Promise<NodeEntity[]> {
    const nodesQuery = this.nodesRepository
      .createQueryBuilder('node')
      .orderBy('node.createdAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    if (workspaceId) {
      nodesQuery.andWhere('node.workspaceId = :workspaceId', { workspaceId });
    }

    if (query.status) {
      nodesQuery.andWhere('node.status = :status', { status: query.status });
    }

    if (query.teamId) {
      nodesQuery.andWhere('node.teamId = :teamId', { teamId: query.teamId });
    }

    if (typeof query.maintenanceMode === 'boolean') {
      nodesQuery.andWhere('node.maintenanceMode = :maintenanceMode', {
        maintenanceMode: query.maintenanceMode,
      });
    }

    if (query.search) {
      nodesQuery.andWhere(
        '(node.name ILIKE :search OR node.hostname ILIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    return this.populateTeamMetadata(await nodesQuery.getMany());
  }

  async findOneOrFail(id: string, workspaceId?: string): Promise<NodeEntity> {
    const node = await this.nodesRepository.findOne({
      where: workspaceId ? { id, workspaceId } : { id },
    });

    if (!node) {
      throw new NotFoundException(`Node ${id} was not found`);
    }

    return this.populateTeamMetadata(node);
  }

  async delete(
    id: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<{ deleted: true; id: string }> {
    const node = await this.findOneOrFail(id, workspaceId);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    // Store metadata before removal
    const nodeName = node.name || node.hostname;
    const nodeWorkspaceId = node.workspaceId;

    await this.nodesRepository.remove(node);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: nodeWorkspaceId,
      action: 'node.deleted',
      targetType: 'node',
      targetId: id,
      targetLabel: nodeName,
      context,
    });

    return { deleted: true, id };
  }

  async ensureExists(
    nodeId: string,
    workspaceId?: string,
  ): Promise<NodeEntity> {
    return this.findOneOrFail(nodeId, workspaceId);
  }

  async createFromEnrollment(input: {
    workspaceId: string;
    teamId?: string | null;
    name: string;
    description: string | null;
    hostname: string;
    os: string;
    arch: string;
    agentTokenHash: string;
    agentVersion?: string | null;
    platformVersion?: string | null;
    kernelVersion?: string | null;
    location?: NodeLocationInput | null;
  }): Promise<NodeEntity> {
    await this.assertHostnameAvailable(input.hostname);
    await this.workspacesService.assertWorkspaceWritable(input.workspaceId);
    const team = input.teamId
      ? await this.workspacesService.findTeamOrFail(
          input.workspaceId,
          input.teamId,
        )
      : null;

    const node = this.nodesRepository.create({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      hostname: input.hostname,
      os: input.os,
      arch: input.arch,
      status: NodeStatus.OFFLINE,
      lastSeenAt: null,
      agentTokenHash: input.agentTokenHash,
      agentVersion: input.agentVersion ?? null,
      platformVersion: input.platformVersion ?? null,
      kernelVersion: input.kernelVersion ?? null,
      lastVersionReportedAt:
        input.agentVersion || input.platformVersion || input.kernelVersion
          ? new Date()
          : null,
      ...this.resolveLocationPatch(input.location),
      teamId: team?.id ?? null,
      notificationEmailEnabled: true,
      notificationEmailLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
      rootAccessExpiresAt: null,
      rootAccessReason: null,
      rootAccessGrantedByUserId: null,
      rootAccessGrantId: null,
      rootAccessLastAppliedAt: null,
      rootAccessLastError: null,
    });

    return this.populateTeamMetadata(await this.nodesRepository.save(node));
  }

  async upsertFromAgentRegistration(input: {
    hostname: string;
    os: string;
    arch: string;
    agentTokenHash: string;
    agentVersion?: string | null;
    platformVersion?: string | null;
    kernelVersion?: string | null;
    location?: NodeLocationInput | null;
  }): Promise<NodeEntity> {
    const existingNode = await this.nodesRepository.findOne({
      where: { hostname: input.hostname },
    });

    const now = new Date();

    if (existingNode) {
      existingNode.os = input.os;
      existingNode.arch = input.arch;
      existingNode.status = NodeStatus.ONLINE;
      existingNode.lastSeenAt = now;
      existingNode.agentTokenHash = input.agentTokenHash;
      existingNode.pendingAgentTokenHash = null;
      existingNode.pendingAgentTokenExpiresAt = null;
      existingNode.agentTokenRevokedAt = null;
      existingNode.name = existingNode.name || existingNode.hostname;
      existingNode.agentVersion =
        input.agentVersion ?? existingNode.agentVersion;
      existingNode.platformVersion =
        input.platformVersion ?? existingNode.platformVersion;
      existingNode.kernelVersion =
        input.kernelVersion ?? existingNode.kernelVersion;
      existingNode.lastVersionReportedAt =
        input.agentVersion || input.platformVersion || input.kernelVersion
          ? now
          : existingNode.lastVersionReportedAt;
      this.applyLocationPatch(existingNode, input.location, now);

      return this.populateTeamMetadata(
        await this.nodesRepository.save(existingNode),
      );
    }

    const node = this.nodesRepository.create({
      workspaceId: (await this.workspacesService.getDefaultWorkspaceOrFail())
        .id,
      name: input.hostname,
      hostname: input.hostname,
      os: input.os,
      arch: input.arch,
      status: NodeStatus.ONLINE,
      lastSeenAt: now,
      agentTokenHash: input.agentTokenHash,
      agentVersion: input.agentVersion ?? null,
      platformVersion: input.platformVersion ?? null,
      kernelVersion: input.kernelVersion ?? null,
      lastVersionReportedAt:
        input.agentVersion || input.platformVersion || input.kernelVersion
          ? now
          : null,
      ...this.resolveLocationPatch(input.location, now),
      notificationEmailEnabled: true,
      notificationEmailLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [...DEFAULT_NODE_NOTIFICATION_LEVELS],
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
      rootAccessExpiresAt: null,
      rootAccessReason: null,
      rootAccessGrantedByUserId: null,
      rootAccessGrantId: null,
      rootAccessLastAppliedAt: null,
      rootAccessLastError: null,
      pendingAgentTokenHash: null,
      pendingAgentTokenExpiresAt: null,
      agentTokenRotatedAt: null,
      agentTokenRevokedAt: null,
    });

    return this.populateTeamMetadata(await this.nodesRepository.save(node));
  }

  async updateTeamAssignment(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    teamId: string | undefined,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    const previousTeamId = node.teamId;
    const team = teamId
      ? await this.workspacesService.findTeamOrFail(node.workspaceId, teamId)
      : null;

    node.teamId = team?.id ?? null;

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );

    await this.eventsService.record({
      nodeId: saved.id,
      type: 'node.team.updated',
      severity: EventSeverity.INFO,
      message: saved.teamId
        ? `Node ${saved.hostname} assigned to team ${saved.teamName ?? saved.teamId}`
        : `Node ${saved.hostname} team assignment cleared`,
      metadata: {
        previousTeamId,
        nextTeamId: saved.teamId,
        nextTeamName: saved.teamName ?? null,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'node.team.updated',
      targetType: 'node',
      targetId: saved.id,
      targetLabel: saved.hostname,
      changes: {
        before: { teamId: previousTeamId },
        after: { teamId: saved.teamId, teamName: saved.teamName ?? null },
      },
      context,
    });

    return saved;
  }

  async enableMaintenance(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    reason: string | undefined,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    node.maintenanceMode = true;
    node.maintenanceReason = reason?.trim() || null;
    node.maintenanceStartedAt = new Date();
    node.maintenanceByUserId = actor.id;

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );

    await this.eventsService.record({
      nodeId: saved.id,
      type: 'node.maintenance.enabled',
      severity: EventSeverity.WARNING,
      message: saved.maintenanceReason
        ? `Node ${saved.hostname} entered maintenance mode: ${saved.maintenanceReason}`
        : `Node ${saved.hostname} entered maintenance mode`,
      metadata: {
        maintenanceReason: saved.maintenanceReason,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'node.maintenance.enabled',
      targetType: 'node',
      targetId: saved.id,
      targetLabel: saved.hostname,
      metadata: {
        maintenanceReason: saved.maintenanceReason,
      },
      context,
    });

    return saved;
  }

  async disableMaintenance(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    const previousReason = node.maintenanceReason;
    node.maintenanceMode = false;
    node.maintenanceReason = null;
    node.maintenanceStartedAt = null;
    node.maintenanceByUserId = null;

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );

    await this.eventsService.record({
      nodeId: saved.id,
      type: 'node.maintenance.disabled',
      severity: EventSeverity.INFO,
      message: `Node ${saved.hostname} left maintenance mode`,
      metadata: {
        previousReason,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'node.maintenance.disabled',
      targetType: 'node',
      targetId: saved.id,
      targetLabel: saved.hostname,
      metadata: {
        previousReason,
      },
      context,
    });

    return saved;
  }

  async updateNotificationSettings(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    dto: UpdateNodeNotificationsDto,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    if (
      dto.notificationEmailEnabled === undefined &&
      dto.notificationEmailLevels === undefined &&
      dto.notificationTelegramEnabled === undefined &&
      dto.notificationTelegramLevels === undefined
    ) {
      return node;
    }

    const before = {
      notificationEmailEnabled: node.notificationEmailEnabled,
      notificationEmailLevels: this.normalizeNotificationLevels(
        node.notificationEmailLevels,
      ),
      notificationTelegramEnabled: node.notificationTelegramEnabled,
      notificationTelegramLevels: this.normalizeNotificationLevels(
        node.notificationTelegramLevels,
      ),
    };

    if (dto.notificationEmailEnabled !== undefined) {
      node.notificationEmailEnabled = dto.notificationEmailEnabled;
    }

    if (dto.notificationEmailLevels !== undefined) {
      node.notificationEmailLevels = this.normalizeNotificationLevels(
        dto.notificationEmailLevels,
      );
    }

    if (dto.notificationTelegramEnabled !== undefined) {
      node.notificationTelegramEnabled = dto.notificationTelegramEnabled;
    }

    if (dto.notificationTelegramLevels !== undefined) {
      node.notificationTelegramLevels = this.normalizeNotificationLevels(
        dto.notificationTelegramLevels,
      );
    }

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );

    await this.eventsService.record({
      nodeId: saved.id,
      type: SYSTEM_EVENT_TYPES.NODE_NOTIFICATIONS_UPDATED,
      severity: EventSeverity.INFO,
      message: `Node ${saved.hostname} notification delivery updated.`,
      metadata: {
        previousEmailEnabled: before.notificationEmailEnabled,
        nextEmailEnabled: saved.notificationEmailEnabled,
        previousEmailLevels: before.notificationEmailLevels,
        nextEmailLevels: saved.notificationEmailLevels,
        previousTelegramEnabled: before.notificationTelegramEnabled,
        nextTelegramEnabled: saved.notificationTelegramEnabled,
        previousTelegramLevels: before.notificationTelegramLevels,
        nextTelegramLevels: saved.notificationTelegramLevels,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'node.notifications.updated',
      targetType: 'node',
      targetId: saved.id,
      targetLabel: saved.hostname,
      changes: {
        before,
        after: {
          notificationEmailEnabled: saved.notificationEmailEnabled,
          notificationEmailLevels: saved.notificationEmailLevels,
          notificationTelegramEnabled: saved.notificationTelegramEnabled,
          notificationTelegramLevels: saved.notificationTelegramLevels,
        },
      },
      context,
    });

    return saved;
  }

  async updateRootAccessProfile(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    dto: UpdateNodeRootAccessDto,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);
    const now = new Date();
    const requestedProfile = dto.profile;
    const isDisabling = requestedProfile === NodeRootAccessProfile.OFF;
    const maxDurationMinutes = this.getRootAccessMaxDurationMinutes();
    const durationMinutes = Math.trunc(dto.durationMinutes ?? 0);
    const reason = dto.reason?.trim() ?? '';

    if (!isDisabling) {
      if (
        !Number.isFinite(durationMinutes) ||
        durationMinutes < ROOT_ACCESS_MIN_DURATION_MINUTES ||
        durationMinutes > maxDurationMinutes
      ) {
        throw new BadRequestException(
          `Root access duration must be between ${ROOT_ACCESS_MIN_DURATION_MINUTES} and ${maxDurationMinutes} minutes.`,
        );
      }

      if (reason.length < 3) {
        throw new BadRequestException(
          'Root access reason is required when enabling a non-off profile.',
        );
      }
    }

    const previousProfile = node.rootAccessProfile;
    const previousSyncStatus = node.rootAccessSyncStatus;
    const previousLastError = node.rootAccessLastError ?? null;
    const previousExpiresAt = node.rootAccessExpiresAt ?? null;
    const previousGrantId = node.rootAccessGrantId ?? null;

    node.rootAccessProfile = requestedProfile;
    node.rootAccessSyncStatus = NodeRootAccessSyncStatus.PENDING;
    node.rootAccessUpdatedAt = now;
    node.rootAccessUpdatedByUserId = actor.id;
    node.rootAccessLastError = null;
    if (isDisabling) {
      node.rootAccessExpiresAt = null;
      node.rootAccessReason = null;
      node.rootAccessGrantedByUserId = null;
      node.rootAccessGrantId = null;
    } else {
      node.rootAccessExpiresAt = new Date(
        now.getTime() + durationMinutes * 60 * 1000,
      );
      node.rootAccessReason = reason;
      node.rootAccessGrantedByUserId = actor.id;
      node.rootAccessGrantId = randomUUID();
    }

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );

    await this.eventsService.record({
      nodeId: saved.id,
      type: SYSTEM_EVENT_TYPES.NODE_ROOT_ACCESS_UPDATED,
      severity: EventSeverity.WARNING,
      message:
        saved.rootAccessProfile === NodeRootAccessProfile.OFF
          ? `Node ${saved.hostname} root access profile was disabled.`
          : `Node ${saved.hostname} root access profile set to ${saved.rootAccessProfile}.`,
      metadata: {
        previousProfile,
        nextProfile: saved.rootAccessProfile,
        syncStatus: saved.rootAccessSyncStatus,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'node.root-access.updated',
      targetType: 'node',
      targetId: saved.id,
      targetLabel: saved.hostname,
      changes: {
        before: {
          rootAccessProfile: previousProfile,
          rootAccessSyncStatus: previousSyncStatus,
          rootAccessLastError: previousLastError,
          rootAccessExpiresAt: this.formatTimestamp(previousExpiresAt),
          rootAccessGrantId: previousGrantId,
        },
        after: {
          rootAccessProfile: saved.rootAccessProfile,
          rootAccessSyncStatus: saved.rootAccessSyncStatus,
          rootAccessLastError: saved.rootAccessLastError ?? null,
          rootAccessExpiresAt: this.formatTimestamp(saved.rootAccessExpiresAt),
          rootAccessReason: saved.rootAccessReason ?? null,
          rootAccessGrantId: saved.rootAccessGrantId ?? null,
        },
      },
      metadata: {
        durationMinutes: isDisabling ? null : durationMinutes,
        reason: saved.rootAccessReason ?? null,
        expiresAt: this.formatTimestamp(saved.rootAccessExpiresAt),
        grantId: saved.rootAccessGrantId ?? null,
      },
      context,
    });

    await this.broadcastRootAccessUpdate(saved);
    return saved;
  }

  async recordAgentRootAccessState(
    nodeId: string,
    report?: NodeRootAccessSyncReport | null,
  ): Promise<NodeEntity | null> {
    if (!report) {
      return null;
    }

    const node = await this.findOneOrFail(nodeId);
    const nextAppliedProfile = this.normalizeRootAccessProfile(
      report.appliedProfile,
      node.rootAccessAppliedProfile,
    );
    const nextLastAppliedAt = this.parseOptionalDate(
      report.lastAppliedAt,
      node.rootAccessLastAppliedAt ?? null,
    );
    const reportedLastError = report.lastError?.trim() || null;
    const nextLastError = this.shouldIgnoreRootAccessSyncError(
      node.rootAccessProfile,
      reportedLastError,
    )
      ? null
      : reportedLastError;
    const nextSyncStatus = this.resolveRootAccessSyncStatus(
      node.rootAccessProfile,
      nextAppliedProfile,
      nextLastError,
    );

    if (
      node.rootAccessAppliedProfile === nextAppliedProfile &&
      node.rootAccessLastError === nextLastError &&
      this.formatTimestamp(node.rootAccessLastAppliedAt) ===
        this.formatTimestamp(nextLastAppliedAt) &&
      node.rootAccessSyncStatus === nextSyncStatus
    ) {
      return node;
    }

    node.rootAccessAppliedProfile = nextAppliedProfile;
    node.rootAccessLastAppliedAt = nextLastAppliedAt;
    node.rootAccessLastError = nextLastError;
    node.rootAccessSyncStatus = nextSyncStatus;

    const saved = await this.populateTeamMetadata(
      await this.nodesRepository.save(node),
    );
    await this.broadcastRootAccessUpdate(saved);
    return saved;
  }

  async listTeamOwnedNodes(
    workspaceId: string,
    teamId: string,
  ): Promise<NodeEntity[]> {
    await this.workspacesService.findTeamOrFail(workspaceId, teamId);

    return this.populateTeamMetadata(
      await this.nodesRepository.find({
        where: {
          workspaceId,
          teamId,
        },
        order: {
          createdAt: 'ASC',
        },
      }),
    );
  }

  assertNodeAcceptingNewWork(node: NodeEntity): void {
    if (node.maintenanceMode) {
      throw new BadRequestException(
        `Node ${node.hostname} is in maintenance mode and cannot accept new work.`,
      );
    }
  }

  assertNodeAllowsOperationalRoot(node: NodeEntity): void {
    if (this.canNodeUseOperationalRoot(node)) {
      return;
    }

    throw new BadRequestException(
      this.isRootAccessGrantExpired(node)
        ? `Node ${node.hostname} root access grant expired at ${this.formatTimestamp(node.rootAccessExpiresAt)}.`
        : `Node ${node.hostname} does not currently allow operational root access. Applied profile is ${node.rootAccessAppliedProfile}, desired profile is ${node.rootAccessProfile}, and sync status is ${node.rootAccessSyncStatus}.`,
    );
  }

  assertNodeAllowsTaskRoot(node: NodeEntity): void {
    this.assertNodeAllowsRootSurface(node, 'task');
  }

  assertNodeAllowsTerminalRoot(node: NodeEntity): void {
    this.assertNodeAllowsRootSurface(node, 'terminal');
  }

  canNodeUseOperationalRoot(
    node: Pick<NodeEntity, 'rootAccessAppliedProfile' | 'rootAccessExpiresAt'>,
  ): boolean {
    if (!this.isRootAccessGrantActive(node)) {
      return false;
    }

    return this.profileAllowsSurface(
      node.rootAccessAppliedProfile,
      'operational',
    );
  }

  canNodeUseTaskRoot(
    node: Pick<NodeEntity, 'rootAccessAppliedProfile' | 'rootAccessExpiresAt'>,
  ): boolean {
    if (!this.isRootAccessGrantActive(node)) {
      return false;
    }

    return this.profileAllowsSurface(node.rootAccessAppliedProfile, 'task');
  }

  canNodeUseTerminalRoot(
    node: Pick<NodeEntity, 'rootAccessAppliedProfile' | 'rootAccessExpiresAt'>,
  ): boolean {
    if (!this.isRootAccessGrantActive(node)) {
      return false;
    }

    return this.profileAllowsSurface(node.rootAccessAppliedProfile, 'terminal');
  }

  buildDesiredRootAccessSnapshot(
    node: Pick<
      NodeEntity,
      | 'rootAccessProfile'
      | 'rootAccessUpdatedAt'
      | 'rootAccessExpiresAt'
      | 'rootAccessGrantId'
    >,
  ): {
    profile: NodeRootAccessProfile;
    updatedAt: string | null;
    expiresAt: string | null;
    grantId: string | null;
  } {
    return {
      profile: node.rootAccessProfile,
      updatedAt: this.formatTimestamp(node.rootAccessUpdatedAt),
      expiresAt: this.formatTimestamp(node.rootAccessExpiresAt),
      grantId: node.rootAccessGrantId ?? null,
    };
  }

  async authenticateAgent(
    nodeId: string,
    agentToken: string,
  ): Promise<NodeEntity> {
    const node = await this.nodesRepository
      .createQueryBuilder('node')
      .addSelect('node.agentTokenHash')
      .addSelect('node.pendingAgentTokenHash')
      .addSelect('node.pendingAgentTokenExpiresAt')
      .where('node.id = :nodeId', { nodeId })
      .getOne();

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    if (!node.agentTokenHash && !node.pendingAgentTokenHash) {
      throw new UnauthorizedException(
        'Agent token is not configured for this node',
      );
    }

    const providedHash = this.hashAgentToken(agentToken);
    const now = new Date();

    if (
      node.agentTokenHash &&
      this.agentTokenHashMatches(providedHash, node.agentTokenHash)
    ) {
      if (
        node.pendingAgentTokenExpiresAt &&
        node.pendingAgentTokenExpiresAt.getTime() <= now.getTime()
      ) {
        node.pendingAgentTokenHash = null;
        node.pendingAgentTokenExpiresAt = null;
        await this.nodesRepository.save(node);
      }
      return node;
    }

    if (
      node.pendingAgentTokenHash &&
      node.pendingAgentTokenExpiresAt &&
      node.pendingAgentTokenExpiresAt.getTime() > now.getTime() &&
      this.agentTokenHashMatches(providedHash, node.pendingAgentTokenHash)
    ) {
      node.agentTokenHash = node.pendingAgentTokenHash;
      node.pendingAgentTokenHash = null;
      node.pendingAgentTokenExpiresAt = null;
      node.agentTokenRotatedAt = now;
      node.agentTokenRevokedAt = null;
      await this.nodesRepository.save(node);
      return node;
    }

    throw new UnauthorizedException('Invalid agent token');
  }

  async stageAgentTokenRotation(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<{ node: NodeEntity; agentToken: string; expiresAt: Date }> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    if (node.status !== NodeStatus.ONLINE) {
      throw new BadRequestException(
        `Node ${node.hostname} must be online before rotating its agent token.`,
      );
    }

    const agentToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + AGENT_TOKEN_ROTATION_PENDING_MS);

    await this.nodesRepository.update(node.id, {
      pendingAgentTokenHash: this.hashAgentToken(agentToken),
      pendingAgentTokenExpiresAt: expiresAt,
      agentTokenRevokedAt: null,
      updatedAt: new Date(),
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: node.workspaceId,
      action: 'node.agent-token.rotate.requested',
      targetType: 'node',
      targetId: node.id,
      targetLabel: node.hostname,
      metadata: {
        nodeId: node.id,
        pendingExpiresAt: expiresAt.toISOString(),
      },
      context,
    });

    return {
      node: await this.findOneOrFail(node.id, node.workspaceId),
      agentToken,
      expiresAt,
    };
  }

  async clearPendingAgentTokenRotation(nodeId: string): Promise<void> {
    await this.nodesRepository.update(nodeId, {
      pendingAgentTokenHash: null,
      pendingAgentTokenExpiresAt: null,
      updatedAt: new Date(),
    });
  }

  async revokeAgentToken(
    nodeId: string,
    workspaceId: string | undefined,
    actor: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<NodeEntity> {
    const node = await this.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(node.workspaceId, actor);
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);

    const now = new Date();
    await this.nodesRepository.update(node.id, {
      agentTokenHash: null,
      pendingAgentTokenHash: null,
      pendingAgentTokenExpiresAt: null,
      agentTokenRevokedAt: now,
      status: NodeStatus.OFFLINE,
      updatedAt: now,
    });

    const saved = await this.findOneOrFail(node.id, node.workspaceId);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: node.workspaceId,
      action: 'node.agent-token.revoked',
      targetType: 'node',
      targetId: node.id,
      targetLabel: node.hostname,
      metadata: {
        nodeId: node.id,
        revokedAt: now.toISOString(),
      },
      context,
    });

    await this.broadcastStatusUpdate(saved);
    return saved;
  }

  async touchOnline(nodeId: string): Promise<NodeEntity> {
    const { node } = await this.markOnline(nodeId);
    return node;
  }

  async markOnline(
    nodeId: string,
    updates?: {
      agentVersion?: string | null;
      platformVersion?: string | null;
      kernelVersion?: string | null;
      location?: NodeLocationInput | null;
    },
  ): Promise<{ node: NodeEntity; transitionedToOnline: boolean }> {
    const now = new Date();
    const locationUpdate = this.resolveLocationPatch(updates?.location, now);
    const versionUpdate =
      updates?.agentVersion ||
      updates?.platformVersion ||
      updates?.kernelVersion
        ? {
            agentVersion: updates.agentVersion ?? null,
            platformVersion: updates.platformVersion ?? null,
            kernelVersion: updates.kernelVersion ?? null,
            lastVersionReportedAt: now,
          }
        : {};
    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.ONLINE,
        lastSeenAt: now,
        updatedAt: now,
        ...versionUpdate,
        ...locationUpdate,
      })
      .where('id = :nodeId', { nodeId })
      .andWhere('status = :status', { status: NodeStatus.OFFLINE })
      .execute();

    if (updateResult.affected) {
      return {
        node: await this.findOneOrFail(nodeId),
        transitionedToOnline: true,
      };
    }

    const node = await this.nodesRepository.findOne({ where: { id: nodeId } });

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    node.status = NodeStatus.ONLINE;
    node.lastSeenAt = now;
    if (updates?.agentVersion) {
      node.agentVersion = updates.agentVersion;
    }
    if (updates?.platformVersion) {
      node.platformVersion = updates.platformVersion;
    }
    if (updates?.kernelVersion) {
      node.kernelVersion = updates.kernelVersion;
    }
    this.applyLocationPatch(node, updates?.location, now);
    if (
      updates?.agentVersion ||
      updates?.platformVersion ||
      updates?.kernelVersion
    ) {
      node.lastVersionReportedAt = now;
    }

    return {
      node: await this.populateTeamMetadata(
        await this.nodesRepository.save(node),
      ),
      transitionedToOnline: false,
    };
  }

  async markOffline(
    nodeId: string,
  ): Promise<{ node: NodeEntity; transitionedToOffline: boolean }> {
    const now = new Date();
    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.OFFLINE,
        updatedAt: now,
      })
      .where('id = :nodeId', { nodeId })
      .andWhere('status = :status', { status: NodeStatus.ONLINE })
      .execute();

    if (updateResult.affected) {
      return {
        node: await this.findOneOrFail(nodeId),
        transitionedToOffline: true,
      };
    }

    const node = await this.findOneOrFail(nodeId);
    if (node.status !== NodeStatus.OFFLINE) {
      node.status = NodeStatus.OFFLINE;
      node.updatedAt = now;
      return {
        node: await this.nodesRepository.save(node),
        transitionedToOffline: false,
      };
    }

    return {
      node,
      transitionedToOffline: false,
    };
  }

  async broadcastStatusUpdate(
    node: Pick<
      NodeEntity,
      | 'id'
      | 'workspaceId'
      | 'hostname'
      | 'status'
      | 'lastSeenAt'
      | 'agentVersion'
      | 'lastVersionReportedAt'
      | 'locationProvider'
      | 'locationSource'
      | 'locationRegion'
      | 'locationZone'
      | 'locationLatitude'
      | 'locationLongitude'
      | 'locationUpdatedAt'
    >,
  ): Promise<void> {
    const statusPayload = {
      nodeId: node.id,
      workspaceId: node.workspaceId,
      hostname: node.hostname,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
      agentVersion: node.agentVersion ?? null,
      lastVersionReportedAt: node.lastVersionReportedAt ?? null,
      location: buildNodeLocationDto(node),
    };

    const payload = {
      ...statusPayload,
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.realtimeGateway.emitNodeStatusUpdate(payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
      payload,
    );
  }

  async broadcastRootAccessUpdate(
    node: Pick<
      NodeEntity,
      | 'id'
      | 'workspaceId'
      | 'rootAccessProfile'
      | 'rootAccessAppliedProfile'
      | 'rootAccessSyncStatus'
      | 'rootAccessUpdatedAt'
      | 'rootAccessUpdatedByUserId'
      | 'rootAccessExpiresAt'
      | 'rootAccessGrantId'
      | 'rootAccessLastAppliedAt'
      | 'rootAccessLastError'
    >,
  ): Promise<void> {
    const payload = {
      nodeId: node.id,
      workspaceId: node.workspaceId,
      rootAccessProfile: node.rootAccessProfile,
      rootAccessAppliedProfile: node.rootAccessAppliedProfile,
      rootAccessSyncStatus: node.rootAccessSyncStatus,
      rootAccessUpdatedAt: this.formatTimestamp(node.rootAccessUpdatedAt),
      rootAccessUpdatedByUserId: node.rootAccessUpdatedByUserId ?? null,
      rootAccessExpiresAt: this.formatTimestamp(node.rootAccessExpiresAt),
      rootAccessGrantId: node.rootAccessGrantId ?? null,
      rootAccessLastAppliedAt: this.formatTimestamp(
        node.rootAccessLastAppliedAt,
      ),
      rootAccessLastError: node.rootAccessLastError ?? null,
    };

    const redisPayload = {
      ...payload,
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.realtimeGateway.emitNodeRootAccessUpdate(redisPayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_ROOT_ACCESS_UPDATED,
      redisPayload,
    );
  }

  async markStaleNodesOffline(): Promise<number> {
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );
    const cutoff = new Date(Date.now() - agents.heartbeatTimeoutSeconds * 1000);
    const updatedAt = new Date();

    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.OFFLINE,
        updatedAt,
      })
      .where('status = :status', { status: NodeStatus.ONLINE })
      .andWhere('lastSeenAt < :cutoff', { cutoff })
      .returning([
        'id',
        'workspaceId',
        'name',
        'hostname',
        'status',
        'lastSeenAt',
        'agentVersion',
        'lastVersionReportedAt',
        'locationProvider',
        'locationSource',
        'locationRegion',
        'locationZone',
        'locationLatitude',
        'locationLongitude',
        'locationUpdatedAt',
      ])
      .execute();

    const offlineNodes = updateResult.raw as Array<
      Pick<
        NodeEntity,
        | 'id'
        | 'workspaceId'
        | 'name'
        | 'hostname'
        | 'status'
        | 'lastSeenAt'
        | 'agentVersion'
        | 'lastVersionReportedAt'
        | 'locationProvider'
        | 'locationSource'
        | 'locationRegion'
        | 'locationZone'
        | 'locationLatitude'
        | 'locationLongitude'
        | 'locationUpdatedAt'
      >
    >;

    if (!offlineNodes.length) {
      return 0;
    }

    for (const node of offlineNodes) {
      await this.eventsService.record({
        nodeId: node.id,
        type: SYSTEM_EVENT_TYPES.NODE_OFFLINE,
        severity: EventSeverity.WARNING,
        message: `Node ${this.getNodeLabel(node)} was marked offline after missing heartbeats for more than ${agents.heartbeatTimeoutSeconds} seconds`,
        metadata: {
          heartbeatTimeoutSeconds: agents.heartbeatTimeoutSeconds,
          lastSeenAt: this.formatTimestamp(node.lastSeenAt),
        },
      });
      await this.broadcastStatusUpdate(node);
    }

    this.logger.log(`Marked ${offlineNodes.length} stale node(s) offline`);

    return offlineNodes.length;
  }

  @Cron('*/60 * * * * *')
  async expireRootAccessGrants(): Promise<number> {
    const now = new Date();
    const expiredNodes = await this.nodesRepository
      .createQueryBuilder('node')
      .where('node.rootAccessProfile != :offProfile', {
        offProfile: NodeRootAccessProfile.OFF,
      })
      .andWhere('node.rootAccessExpiresAt IS NOT NULL')
      .andWhere('node.rootAccessExpiresAt <= :now', { now })
      .getMany();

    for (const node of expiredNodes) {
      const previousProfile = node.rootAccessProfile;
      const previousGrantId = node.rootAccessGrantId ?? null;

      node.rootAccessProfile = NodeRootAccessProfile.OFF;
      node.rootAccessSyncStatus = NodeRootAccessSyncStatus.PENDING;
      node.rootAccessUpdatedAt = now;
      node.rootAccessUpdatedByUserId = null;
      node.rootAccessExpiresAt = null;
      node.rootAccessReason = null;
      node.rootAccessGrantedByUserId = null;
      node.rootAccessGrantId = null;
      node.rootAccessLastError = null;

      const saved = await this.nodesRepository.save(node);

      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId: saved.workspaceId,
        action: 'node.root-access.expired',
        targetType: 'node',
        targetId: saved.id,
        targetLabel: saved.hostname,
        metadata: {
          nodeId: saved.id,
          previousProfile,
          previousGrantId,
          expiredAt: now.toISOString(),
        },
        context: {
          actorType: 'system',
        },
      });

      await this.broadcastRootAccessUpdate(saved);
    }

    return expiredNodes.length;
  }

  hashAgentToken(agentToken: string): string {
    return createHash('sha256').update(agentToken).digest('hex');
  }

  private agentTokenHashMatches(
    providedHash: string,
    storedHash: string,
  ): boolean {
    const providedBuffer = Buffer.from(providedHash);
    const storedBuffer = Buffer.from(storedHash);

    return (
      providedBuffer.length === storedBuffer.length &&
      timingSafeEqual(providedBuffer, storedBuffer)
    );
  }

  private async assertHostnameAvailable(hostname: string): Promise<void> {
    const existingNode = await this.nodesRepository.findOne({
      where: { hostname },
    });

    if (existingNode) {
      throw new ConflictException('A node with this hostname already exists');
    }
  }

  private getNodeLabel(node: Pick<NodeEntity, 'name' | 'hostname'>): string {
    if (!node.name || node.name === node.hostname) {
      return node.hostname;
    }

    return `${node.name} (${node.hostname})`;
  }

  private formatTimestamp(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  private parseOptionalDate(
    value: string | null | undefined,
    fallback: Date | null,
  ): Date | null {
    if (!value) {
      return fallback;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  private normalizeRootAccessProfile(
    value: string | null | undefined,
    fallback: NodeRootAccessProfile,
  ): NodeRootAccessProfile {
    return NODE_ROOT_ACCESS_PROFILES.includes(value as NodeRootAccessProfile)
      ? (value as NodeRootAccessProfile)
      : fallback;
  }

  private resolveRootAccessSyncStatus(
    desiredProfile: NodeRootAccessProfile,
    appliedProfile: NodeRootAccessProfile,
    lastError: string | null,
  ) {
    if (lastError) {
      return NodeRootAccessSyncStatus.FAILED;
    }

    if (desiredProfile === appliedProfile) {
      return NodeRootAccessSyncStatus.APPLIED;
    }

    return NodeRootAccessSyncStatus.PENDING;
  }

  private assertNodeAllowsRootSurface(
    node: NodeEntity,
    surface: NodeRootAccessSurface,
  ): void {
    if (!this.isRootAccessGrantActive(node)) {
      throw new BadRequestException(
        this.isRootAccessGrantExpired(node)
          ? `Node ${node.hostname} root access grant expired at ${this.formatTimestamp(node.rootAccessExpiresAt)}.`
          : `Node ${node.hostname} does not have an active root access grant.`,
      );
    }

    if (this.profileAllowsSurface(node.rootAccessAppliedProfile, surface)) {
      return;
    }

    throw new BadRequestException(
      `Node ${node.hostname} does not currently allow ${surface} root access. Applied profile is ${node.rootAccessAppliedProfile}.`,
    );
  }

  private isRootAccessGrantActive(
    node: Pick<NodeEntity, 'rootAccessExpiresAt'>,
  ): boolean {
    return !this.isRootAccessGrantExpired(node);
  }

  private isRootAccessGrantExpired(
    node: Pick<NodeEntity, 'rootAccessExpiresAt'>,
  ): boolean {
    return Boolean(
      node.rootAccessExpiresAt &&
      node.rootAccessExpiresAt.getTime() <= Date.now(),
    );
  }

  private getRootAccessMaxDurationMinutes(): number {
    const agents =
      this.configService.get<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );
    const configured = agents?.rootAccessMaxDurationMinutes;

    return Math.max(
      ROOT_ACCESS_MIN_DURATION_MINUTES,
      Number.isFinite(configured)
        ? Number(configured)
        : ROOT_ACCESS_DEFAULT_MAX_DURATION_MINUTES,
    );
  }

  private profileAllowsSurface(
    profile: NodeRootAccessProfile,
    surface: NodeRootAccessSurface,
  ): boolean {
    switch (surface) {
      case 'operational':
        return (
          profile === NodeRootAccessProfile.OPERATIONAL ||
          profile === NodeRootAccessProfile.OPERATIONAL_TASK ||
          profile === NodeRootAccessProfile.OPERATIONAL_TERMINAL ||
          profile === NodeRootAccessProfile.ALL
        );
      case 'task':
        return (
          profile === NodeRootAccessProfile.TASK ||
          profile === NodeRootAccessProfile.OPERATIONAL_TASK ||
          profile === NodeRootAccessProfile.TASK_TERMINAL ||
          profile === NodeRootAccessProfile.ALL
        );
      case 'terminal':
        return (
          profile === NodeRootAccessProfile.TERMINAL ||
          profile === NodeRootAccessProfile.OPERATIONAL_TERMINAL ||
          profile === NodeRootAccessProfile.TASK_TERMINAL ||
          profile === NodeRootAccessProfile.ALL
        );
      default:
        return false;
    }
  }

  private shouldIgnoreRootAccessSyncError(
    desiredProfile: NodeRootAccessProfile,
    reportedError: string | null,
  ): boolean {
    void desiredProfile;
    void reportedError;
    return false;
  }

  private normalizeNotificationLevels(
    levels: EventSeverity[] | null | undefined,
  ): EventSeverity[] {
    if (!levels) {
      return [...DEFAULT_NODE_NOTIFICATION_LEVELS];
    }

    return DEFAULT_NODE_NOTIFICATION_LEVELS.filter((severity) =>
      levels.includes(severity),
    );
  }

  private async populateTeamMetadata<T extends NodeEntity | NodeEntity[]>(
    input: T,
  ): Promise<T> {
    const nodes = Array.isArray(input) ? input : [input];
    nodes.forEach((node) => {
      node.location = buildNodeLocationDto(node);
    });
    const teamIds = Array.from(
      new Set(
        nodes
          .map((node) => node.teamId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (teamIds.length === 0) {
      nodes.forEach((node) => {
        node.teamName = null;
      });
      return input;
    }

    const teams = await Promise.all(
      teamIds.map(async (teamId) => {
        const node = nodes.find((entry) => entry.teamId === teamId);
        if (!node) {
          return null;
        }

        return this.workspacesService.findTeamOrFail(node.workspaceId, teamId);
      }),
    );
    const lookup = new Map(
      teams
        .filter((team): team is NonNullable<typeof team> => Boolean(team))
        .map((team) => [team.id, team.name] as const),
    );

    nodes.forEach((node) => {
      node.teamName = node.teamId ? (lookup.get(node.teamId) ?? null) : null;
    });

    return input;
  }

  private resolveLocationPatch(
    location: NodeLocationInput | null | undefined,
    updatedAt = new Date(),
  ): Partial<NodeLocationFields> {
    return resolveNodeLocationFields(location, updatedAt) ?? {};
  }

  private applyLocationPatch(
    node: NodeEntity,
    location: NodeLocationInput | null | undefined,
    updatedAt = new Date(),
  ): void {
    const patch = resolveNodeLocationFields(location, updatedAt);
    if (!patch) {
      return;
    }

    Object.assign(node, patch);
  }
}
