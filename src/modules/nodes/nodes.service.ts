import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
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
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { UpdateNodeRootAccessDto } from './dto/update-node-root-access.dto';
import { NodeEntity } from './entities/node.entity';
import {
  NODE_ROOT_ACCESS_PROFILES,
  NodeRootAccessProfile,
} from './entities/node-root-access-profile.enum';
import { NodeRootAccessSyncStatus } from './entities/node-root-access-sync-status.enum';
import { NodeStatus } from './entities/node-status.enum';

type NodeRootAccessSurface = 'operational' | 'task' | 'terminal';
const ROOT_PROFILE_HELPER_MISSING_ERROR = 'root profile helper is not installed';

type NodeRootAccessSyncReport = {
  appliedProfile?: NodeRootAccessProfile | null;
  lastAppliedAt?: string | null;
  lastError?: string | null;
};

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
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
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
      teamId: team?.id ?? null,
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
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

      return this.nodesRepository.save(existingNode);
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
      rootAccessProfile: NodeRootAccessProfile.OFF,
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
      rootAccessUpdatedAt: null,
      rootAccessUpdatedByUserId: null,
      rootAccessLastAppliedAt: null,
      rootAccessLastError: null,
    });

    return this.nodesRepository.save(node);
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

    const previousProfile = node.rootAccessProfile;
    const previousSyncStatus = node.rootAccessSyncStatus;
    const previousLastError = node.rootAccessLastError ?? null;

    node.rootAccessProfile = dto.profile;
    node.rootAccessSyncStatus = NodeRootAccessSyncStatus.PENDING;
    node.rootAccessUpdatedAt = new Date();
    node.rootAccessUpdatedByUserId = actor.id;
    node.rootAccessLastError = null;

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
        },
        after: {
          rootAccessProfile: saved.rootAccessProfile,
          rootAccessSyncStatus: saved.rootAccessSyncStatus,
          rootAccessLastError: saved.rootAccessLastError ?? null,
        },
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
      `Node ${node.hostname} does not currently allow operational root access. Applied profile is ${node.rootAccessAppliedProfile}, desired profile is ${node.rootAccessProfile}, and sync status is ${node.rootAccessSyncStatus}.`,
    );
  }

  assertNodeAllowsTaskRoot(node: NodeEntity): void {
    this.assertNodeAllowsRootSurface(node, 'task');
  }

  assertNodeAllowsTerminalRoot(node: NodeEntity): void {
    this.assertNodeAllowsRootSurface(node, 'terminal');
  }

  canNodeUseOperationalRoot(
    node: Pick<
      NodeEntity,
      | 'rootAccessAppliedProfile'
      | 'rootAccessProfile'
      | 'rootAccessSyncStatus'
      | 'rootAccessLastError'
    >,
  ): boolean {
    if (
      this.profileAllowsSurface(node.rootAccessAppliedProfile, 'operational')
    ) {
      return true;
    }

    const helperMissingFailure =
      node.rootAccessSyncStatus === NodeRootAccessSyncStatus.FAILED &&
      this.isRootProfileHelperMissingError(node.rootAccessLastError ?? null);

    return (
      this.profileAllowsSurface(node.rootAccessProfile, 'operational') &&
      (node.rootAccessSyncStatus !== NodeRootAccessSyncStatus.FAILED ||
        helperMissingFailure)
    );
  }

  canNodeUseTaskRoot(
    node: Pick<NodeEntity, 'rootAccessAppliedProfile'>,
  ): boolean {
    return this.profileAllowsSurface(node.rootAccessAppliedProfile, 'task');
  }

  canNodeUseTerminalRoot(
    node: Pick<NodeEntity, 'rootAccessAppliedProfile'>,
  ): boolean {
    return this.profileAllowsSurface(node.rootAccessAppliedProfile, 'terminal');
  }

  buildDesiredRootAccessSnapshot(
    node: Pick<NodeEntity, 'rootAccessProfile' | 'rootAccessUpdatedAt'>,
  ): { profile: NodeRootAccessProfile; updatedAt: string | null } {
    return {
      profile: node.rootAccessProfile,
      updatedAt: this.formatTimestamp(node.rootAccessUpdatedAt),
    };
  }

  async authenticateAgent(
    nodeId: string,
    agentToken: string,
  ): Promise<NodeEntity> {
    const node = await this.nodesRepository
      .createQueryBuilder('node')
      .addSelect('node.agentTokenHash')
      .where('node.id = :nodeId', { nodeId })
      .getOne();

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    if (!node.agentTokenHash) {
      throw new UnauthorizedException(
        'Agent token is not configured for this node',
      );
    }

    const providedHash = this.hashAgentToken(agentToken);
    const storedHash = node.agentTokenHash;

    // Constant-time comparison to prevent timing attacks
    const providedBuffer = Buffer.from(providedHash);
    const storedBuffer = Buffer.from(storedHash);

    if (
      providedBuffer.length !== storedBuffer.length ||
      !timingSafeEqual(providedBuffer, storedBuffer)
    ) {
      throw new UnauthorizedException('Invalid agent token');
    }

    return node;
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
    },
  ): Promise<{ node: NodeEntity; transitionedToOnline: boolean }> {
    const now = new Date();
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
    if (
      updates?.agentVersion ||
      updates?.platformVersion ||
      updates?.kernelVersion
    ) {
      node.lastVersionReportedAt = now;
    }

    return {
      node: await this.nodesRepository.save(node),
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
      | 'hostname'
      | 'status'
      | 'lastSeenAt'
      | 'agentVersion'
      | 'lastVersionReportedAt'
    >,
  ): Promise<void> {
    const statusPayload = {
      nodeId: node.id,
      hostname: node.hostname,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
      agentVersion: node.agentVersion ?? null,
      lastVersionReportedAt: node.lastVersionReportedAt ?? null,
    };

    this.realtimeGateway.emitNodeStatusUpdate(statusPayload);
    await this.redisService.publish(PUBSUB_CHANNELS.NODES_STATUS_UPDATED, {
      ...statusPayload,
      sourceInstanceId: this.redisService.getInstanceId(),
    });
  }

  async broadcastRootAccessUpdate(
    node: Pick<
      NodeEntity,
      | 'id'
      | 'rootAccessProfile'
      | 'rootAccessAppliedProfile'
      | 'rootAccessSyncStatus'
      | 'rootAccessUpdatedAt'
      | 'rootAccessUpdatedByUserId'
      | 'rootAccessLastAppliedAt'
      | 'rootAccessLastError'
    >,
  ): Promise<void> {
    const payload = {
      nodeId: node.id,
      rootAccessProfile: node.rootAccessProfile,
      rootAccessAppliedProfile: node.rootAccessAppliedProfile,
      rootAccessSyncStatus: node.rootAccessSyncStatus,
      rootAccessUpdatedAt: this.formatTimestamp(node.rootAccessUpdatedAt),
      rootAccessUpdatedByUserId: node.rootAccessUpdatedByUserId ?? null,
      rootAccessLastAppliedAt: this.formatTimestamp(
        node.rootAccessLastAppliedAt,
      ),
      rootAccessLastError: node.rootAccessLastError ?? null,
    };

    this.realtimeGateway.emitNodeRootAccessUpdate(payload);
    await this.redisService.publish(PUBSUB_CHANNELS.NODES_ROOT_ACCESS_UPDATED, {
      ...payload,
      sourceInstanceId: this.redisService.getInstanceId(),
    });
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
      .returning(['id', 'name', 'hostname', 'status', 'lastSeenAt'])
      .execute();

    const offlineNodes = updateResult.raw as Array<
      Pick<NodeEntity, 'id' | 'name' | 'hostname' | 'status' | 'lastSeenAt'>
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

  hashAgentToken(agentToken: string): string {
    return createHash('sha256').update(agentToken).digest('hex');
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
    if (this.profileAllowsSurface(node.rootAccessAppliedProfile, surface)) {
      return;
    }

    throw new BadRequestException(
      `Node ${node.hostname} does not currently allow ${surface} root access. Applied profile is ${node.rootAccessAppliedProfile}.`,
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
          profile === NodeRootAccessProfile.ALL
        );
      case 'task':
        return (
          profile === NodeRootAccessProfile.TASK ||
          profile === NodeRootAccessProfile.ALL
        );
      case 'terminal':
        return (
          profile === NodeRootAccessProfile.TERMINAL ||
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
    return (
      desiredProfile !== NodeRootAccessProfile.OFF &&
      this.isRootProfileHelperMissingError(reportedError)
    );
  }

  private isRootProfileHelperMissingError(error: string | null): boolean {
    return Boolean(
      error?.toLowerCase().includes(ROOT_PROFILE_HELPER_MISSING_ERROR),
    );
  }

  private async populateTeamMetadata<T extends NodeEntity | NodeEntity[]>(
    input: T,
  ): Promise<T> {
    const nodes = Array.isArray(input) ? input : [input];
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
}
