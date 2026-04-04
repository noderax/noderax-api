import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { TASK_TYPES } from '../../common/constants/task-types.constants';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { AuthenticatedAgent } from '../../common/types/authenticated-agent.type';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventsService } from '../events/events.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodesService } from '../nodes/nodes.service';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { TasksService } from '../tasks/tasks.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { AgentReleaseCatalogService } from './agent-release-catalog.service';
import { AgentReleaseDto } from './dto/agent-release.dto';
import {
  AgentUpdateRolloutCountsDto,
  AgentUpdateRolloutDto,
  AgentUpdateRolloutTargetDto,
  AgentUpdateSummaryDto,
} from './dto/agent-update-rollout.dto';
import { CreateAgentUpdateRolloutDto } from './dto/create-agent-update-rollout.dto';
import { ReportAgentUpdateProgressDto } from './dto/report-agent-update-progress.dto';
import { AgentUpdateRolloutEntity } from './entities/agent-update-rollout.entity';
import { AgentUpdateRolloutTargetEntity } from './entities/agent-update-rollout-target.entity';
import {
  AGENT_UPDATE_TARGET_ACTIVE_STATUSES,
  AGENT_UPDATE_TARGET_TERMINAL_STATUSES,
  AgentUpdateRolloutStatus,
  AgentUpdateTargetStatus,
} from './entities/agent-update-statuses';

const SUPPORTED_ARCHES = new Set(['amd64', 'arm64']);

@Injectable()
export class AgentUpdatesService {
  private readonly logger = new Logger(AgentUpdatesService.name);

  constructor(
    @InjectRepository(AgentUpdateRolloutEntity)
    private readonly rolloutsRepository: Repository<AgentUpdateRolloutEntity>,
    @InjectRepository(AgentUpdateRolloutTargetEntity)
    private readonly targetsRepository: Repository<AgentUpdateRolloutTargetEntity>,
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    private readonly releaseCatalogService: AgentReleaseCatalogService,
    private readonly nodesService: NodesService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    private readonly eventsService: EventsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getSummary(): Promise<AgentUpdateSummaryDto> {
    const catalog = await this.releaseCatalogService.getCatalog();
    const latestRelease = catalog.releases[0] ?? null;
    const activeRollout = await this.findActiveRollout();

    const [outdatedNodeCount, eligibleOutdatedNodeCount] = latestRelease
      ? await Promise.all([
          this.countOutdatedNodes(latestRelease.version),
          this.countEligibleOutdatedNodes(latestRelease.version),
        ])
      : [0, 0];

    return {
      latestRelease,
      outdatedNodeCount,
      eligibleOutdatedNodeCount,
      activeRollout,
      releaseCheckedAt: catalog.checkedAt?.toISOString() ?? null,
    };
  }

  async listReleases(): Promise<AgentReleaseDto[]> {
    const catalog = await this.releaseCatalogService.getCatalog();
    return catalog.releases;
  }

  async listRollouts(): Promise<AgentUpdateRolloutDto[]> {
    const rollouts = await this.rolloutsRepository.find({
      order: {
        createdAt: 'DESC',
      },
      take: 20,
    });

    if (!rollouts.length) {
      return [];
    }

    const targets = await this.targetsRepository.find({
      where: {
        rolloutId: In(rollouts.map((rollout) => rollout.id)),
      },
      order: {
        sequence: 'ASC',
      },
    });

    return rollouts.map((rollout) =>
      this.toRolloutDto(
        rollout,
        targets.filter((target) => target.rolloutId === rollout.id),
      ),
    );
  }

  async getRollout(id: string): Promise<AgentUpdateRolloutDto> {
    const rollout = await this.findRolloutEntityOrFail(id);
    const targets = await this.targetsRepository.find({
      where: { rolloutId: rollout.id },
      order: { sequence: 'ASC' },
    });

    return this.toRolloutDto(rollout, targets);
  }

  async createRollout(
    dto: CreateAgentUpdateRolloutDto,
    context: RequestAuditContext,
  ): Promise<AgentUpdateRolloutDto> {
    await this.assertNoActiveRolloutExists();

    const release = dto.version
      ? await this.releaseCatalogService.findRelease(dto.version)
      : ((await this.releaseCatalogService.getCatalog()).releases[0] ?? null);

    if (!release) {
      throw new BadRequestException(
        'No official tagged agent release is currently available.',
      );
    }

    const nodeIds = Array.from(
      new Set(dto.nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean)),
    );
    if (!nodeIds.length) {
      throw new BadRequestException('Select at least one node.');
    }

    const targetsInput: Array<{
      node: NodeEntity;
      previousVersion: string | null;
    }> = [];

    for (const nodeId of nodeIds) {
      const node = await this.nodesService.ensureExists(nodeId);
      this.assertNodeEligibleForRollout(node, release.version);
      targetsInput.push({
        node,
        previousVersion: node.agentVersion ?? null,
      });
    }

    const rollout = await this.rolloutsRepository.save(
      this.rolloutsRepository.create({
        targetVersion: release.version,
        status: 'queued',
        rollback: dto.rollback ?? false,
        requestedByUserId: context.actorUserId ?? null,
        requestedByEmailSnapshot: context.actorEmailSnapshot ?? null,
        statusMessage: `Queued ${targetsInput.length} ${targetsInput.length === 1 ? 'node' : 'nodes'} for agent ${dto.rollback ? 'rollback' : 'update'} to ${release.version}.`,
      }),
    );

    const targets = await this.targetsRepository.save(
      targetsInput.map(({ node, previousVersion }, index) =>
        this.targetsRepository.create({
          rolloutId: rollout.id,
          nodeId: node.id,
          workspaceId: node.workspaceId,
          teamId: node.teamId ?? null,
          nodeNameSnapshot: node.name || node.hostname,
          previousVersion,
          targetVersion: release.version,
          status: 'pending',
          progressPercent: 0,
          statusMessage: 'Waiting for rollout dispatch.',
          taskId: null,
          sequence: index,
          dispatchedAt: null,
          completedAt: null,
        }),
      ),
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'agent_update.rollout.created',
      targetType: 'agent_update_rollout',
      targetId: rollout.id,
      targetLabel: release.version,
      metadata: {
        rollback: rollout.rollback,
        nodeIds,
        targetVersion: release.version,
      },
      context,
    });

    await this.recordRolloutEvent(
      targets[0]?.nodeId ?? null,
      SYSTEM_EVENT_TYPES.AGENT_UPDATE_ROLLOUT_CREATED,
      EventSeverity.INFO,
      `Agent ${rollout.rollback ? 'rollback' : 'update'} rollout created for ${targets.length} ${targets.length === 1 ? 'node' : 'nodes'} targeting ${release.version}.`,
      {
        rolloutId: rollout.id,
        targetVersion: release.version,
        rollback: rollout.rollback,
      },
    );

    const nextRollout = await this.setRolloutStatus(
      rollout,
      'running',
      `Dispatching node 1 of ${targets.length}.`,
      {
        startedAt: new Date(),
      },
    );
    await this.dispatchNextTarget(nextRollout.id);

    return this.getRollout(rollout.id);
  }

  async resumeRollout(
    rolloutId: string,
    context: RequestAuditContext,
  ): Promise<AgentUpdateRolloutDto> {
    const rollout = await this.findRolloutEntityOrFail(rolloutId);
    if (rollout.status !== 'paused') {
      throw new ConflictException('Only paused rollouts can be resumed.');
    }

    const failedTargetCount = await this.targetsRepository.count({
      where: {
        rolloutId: rollout.id,
        status: 'failed',
      },
    });
    if (failedTargetCount > 0) {
      throw new ConflictException(
        'Retry or skip failed targets before resuming this rollout.',
      );
    }

    await this.setRolloutStatus(
      rollout,
      'running',
      'Rollout resumed by an operator.',
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'agent_update.rollout.resumed',
      targetType: 'agent_update_rollout',
      targetId: rollout.id,
      targetLabel: rollout.targetVersion,
      context,
    });

    await this.dispatchNextTarget(rollout.id);
    return this.getRollout(rollout.id);
  }

  async cancelRollout(
    rolloutId: string,
    context: RequestAuditContext,
  ): Promise<AgentUpdateRolloutDto> {
    const rollout = await this.findRolloutEntityOrFail(rolloutId);
    if (rollout.status === 'completed' || rollout.status === 'cancelled') {
      throw new ConflictException('This rollout is already terminal.');
    }

    const cancelledAt = new Date();

    await this.rolloutsRepository.save({
      ...rollout,
      status: 'cancelled',
      statusMessage:
        'Rollout cancelled by an operator. Pending targets were cancelled and active targets received cancellation requests.',
      cancelledAt,
    });

    const targets = await this.targetsRepository.find({
      where: { rolloutId: rollout.id },
      order: { sequence: 'ASC' },
    });

    for (const target of targets) {
      if (target.status === 'pending') {
        await this.targetsRepository.save({
          ...target,
          status: 'cancelled',
          statusMessage: 'Cancelled before dispatch.',
          completedAt: cancelledAt,
          progressPercent: 0,
        });
        continue;
      }

      if (
        (
          AGENT_UPDATE_TARGET_ACTIVE_STATUSES as readonly AgentUpdateTargetStatus[]
        ).includes(target.status)
      ) {
        await this.targetsRepository.save({
          ...target,
          status: 'cancelled',
          statusMessage:
            'Cancelled by operator. In-flight updater was asked to stop; local update may still complete if it already passed handoff.',
          completedAt: cancelledAt,
          progressPercent: target.progressPercent,
        });

        await this.requestTaskCancellationForTarget(target);
      }
    }

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'agent_update.rollout.cancelled',
      targetType: 'agent_update_rollout',
      targetId: rollout.id,
      targetLabel: rollout.targetVersion,
      context,
    });

    return this.getRollout(rollout.id);
  }

  async retryTarget(
    rolloutId: string,
    targetId: string,
    context: RequestAuditContext,
  ): Promise<AgentUpdateRolloutDto> {
    const { rollout, target } = await this.findPausedFailedTarget(
      rolloutId,
      targetId,
    );

    await this.targetsRepository.save({
      ...target,
      status: 'pending',
      progressPercent: 0,
      statusMessage: 'Retry queued by an operator.',
      taskId: null,
      dispatchedAt: null,
      completedAt: null,
    });

    await this.setRolloutStatus(
      rollout,
      'running',
      `Retrying ${target.nodeNameSnapshot}.`,
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'agent_update.target.retried',
      targetType: 'agent_update_rollout_target',
      targetId: target.id,
      targetLabel: target.nodeNameSnapshot,
      metadata: {
        rolloutId: rollout.id,
        targetVersion: rollout.targetVersion,
      },
      context,
    });

    await this.dispatchNextTarget(rollout.id);
    return this.getRollout(rollout.id);
  }

  async skipTarget(
    rolloutId: string,
    targetId: string,
    context: RequestAuditContext,
  ): Promise<AgentUpdateRolloutDto> {
    const { rollout, target } = await this.findPausedFailedTarget(
      rolloutId,
      targetId,
    );

    await this.targetsRepository.save({
      ...target,
      status: 'skipped',
      progressPercent: target.progressPercent,
      statusMessage: target.statusMessage ?? 'Skipped after operator review.',
      completedAt: target.completedAt ?? new Date(),
    });

    await this.setRolloutStatus(
      rollout,
      'running',
      `Skipping ${target.nodeNameSnapshot} and continuing the rollout.`,
    );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'agent_update.target.skipped',
      targetType: 'agent_update_rollout_target',
      targetId: target.id,
      targetLabel: target.nodeNameSnapshot,
      metadata: {
        rolloutId: rollout.id,
        targetVersion: rollout.targetVersion,
      },
      context,
    });

    await this.dispatchNextTarget(rollout.id);
    return this.getRollout(rollout.id);
  }

  async handleAgentProgress(
    targetId: string,
    dto: ReportAgentUpdateProgressDto,
    agent: AuthenticatedAgent,
  ): Promise<AgentUpdateRolloutTargetDto> {
    const target = await this.findTargetEntityOrFail(targetId);
    if (target.nodeId !== agent.nodeId) {
      throw new ConflictException(
        'The authenticated agent cannot report progress for this rollout target.',
      );
    }

    const rollout = await this.findRolloutEntityOrFail(target.rolloutId);
    if (this.isTargetTerminal(target.status)) {
      return this.toTargetDto(target);
    }

    const nextTarget = await this.targetsRepository.save({
      ...target,
      status: dto.status,
      progressPercent: dto.progressPercent,
      statusMessage: dto.message ?? target.statusMessage,
      completedAt: dto.status === 'failed' ? new Date() : target.completedAt,
    });

    if (dto.status === 'failed') {
      await this.pauseRolloutForTargetFailure(
        rollout,
        nextTarget,
        dto.message ??
          `${nextTarget.nodeNameSnapshot} reported an update failure.`,
      );
    } else if (rollout.status !== 'cancelled') {
      await this.rolloutsRepository.save({
        ...rollout,
        statusMessage:
          dto.message ??
          `${nextTarget.nodeNameSnapshot} is ${dto.status.replace(/_/g, ' ')}.`,
      });
    }

    if (dto.status === 'waiting_for_reconnect') {
      const node = await this.nodesRepository.findOne({
        where: { id: nextTarget.nodeId },
        select: {
          id: true,
          agentVersion: true,
        },
      });

      if (node?.agentVersion === nextTarget.targetVersion) {
        await this.observeNodeVersion({
          id: node.id,
          agentVersion: node.agentVersion,
        });
      }
    }

    return this.toTargetDto(nextTarget);
  }

  async observeNodeVersion(
    node: Pick<NodeEntity, 'id' | 'agentVersion'>,
  ): Promise<void> {
    const target = await this.targetsRepository
      .createQueryBuilder('target')
      .innerJoin(
        AgentUpdateRolloutEntity,
        'rollout',
        'rollout.id = target."rolloutId"',
      )
      .where('target."nodeId" = :nodeId', { nodeId: node.id })
      .andWhere('target.status NOT IN (:...terminalStatuses)', {
        terminalStatuses: AGENT_UPDATE_TARGET_TERMINAL_STATUSES,
      })
      .andWhere('rollout.status IN (:...rolloutStatuses)', {
        rolloutStatuses: ['running', 'paused'] as AgentUpdateRolloutStatus[],
      })
      .orderBy('target.sequence', 'ASC')
      .getOne();

    if (
      !target ||
      !node.agentVersion ||
      target.targetVersion !== node.agentVersion
    ) {
      return;
    }

    const rollout = await this.findRolloutEntityOrFail(target.rolloutId);
    const completedTarget = await this.targetsRepository.save({
      ...target,
      status: 'completed',
      progressPercent: 100,
      statusMessage: `Agent reconnect confirmed ${node.agentVersion}.`,
      completedAt: new Date(),
    });

    await this.syncLinkedTaskTerminalState(
      completedTarget,
      TaskStatus.SUCCESS,
      `Agent reconnect confirmed ${node.agentVersion}.`,
    );

    await this.recordRolloutEvent(
      target.nodeId,
      SYSTEM_EVENT_TYPES.AGENT_UPDATE_TARGET_COMPLETED,
      EventSeverity.INFO,
      `${target.nodeNameSnapshot} reported agent ${node.agentVersion}.`,
      {
        rolloutId: rollout.id,
        targetId: target.id,
        targetVersion: target.targetVersion,
      },
    );

    if (rollout.status === 'running') {
      await this.dispatchNextTarget(rollout.id);
    }
  }

  async reconcileActiveTargets(): Promise<number> {
    const now = Date.now();
    const targets = await this.targetsRepository
      .createQueryBuilder('target')
      .innerJoin(
        AgentUpdateRolloutEntity,
        'rollout',
        'rollout.id = target."rolloutId"',
      )
      .where('target.status IN (:...activeStatuses)', {
        activeStatuses: AGENT_UPDATE_TARGET_ACTIVE_STATUSES,
      })
      .andWhere('rollout.status = :rolloutStatus', {
        rolloutStatus: 'running',
      })
      .orderBy('target.updatedAt', 'ASC')
      .getMany();

    const failedTasksById = await this.loadFailedTasksById(targets);

    let pausedTargets = 0;
    for (const target of targets) {
      const node = await this.nodesRepository.findOne({
        where: { id: target.nodeId },
      });

      if (
        node?.status === 'online' &&
        node.agentVersion === target.targetVersion
      ) {
        await this.observeNodeVersion({
          id: target.nodeId,
          agentVersion: node.agentVersion,
        });
        continue;
      }

      const rollout = await this.findRolloutEntityOrFail(target.rolloutId);
      const failedTask = target.taskId
        ? (failedTasksById.get(target.taskId) ?? null)
        : null;

      if (failedTask) {
        await this.pauseRolloutForTargetFailure(
          rollout,
          {
            ...target,
            completedAt: new Date(),
          },
          this.buildTaskFailureMessage(target, failedTask),
        );
        pausedTargets += 1;
        continue;
      }

      const thresholdMs = this.resolveTargetTimeoutThresholdMs(target.status);
      if (now - target.updatedAt.getTime() < thresholdMs) {
        continue;
      }

      await this.pauseRolloutForTargetFailure(
        rollout,
        {
          ...target,
          status: 'failed',
          completedAt: new Date(),
          progressPercent: target.progressPercent,
        },
        `${target.nodeNameSnapshot} timed out while waiting for ${target.status.replace(/_/g, ' ')}.`,
      );
      pausedTargets += 1;
    }

    return pausedTargets;
  }

  async markTimedOutTargets(): Promise<number> {
    return this.reconcileActiveTargets();
  }

  async findActiveRollout(): Promise<AgentUpdateRolloutDto | null> {
    const rollout = await this.rolloutsRepository.findOne({
      where: [
        { status: 'queued' },
        { status: 'running' },
        { status: 'paused' },
      ],
      order: {
        createdAt: 'DESC',
      },
    });

    if (!rollout) {
      return null;
    }

    const targets = await this.targetsRepository.find({
      where: { rolloutId: rollout.id },
      order: { sequence: 'ASC' },
    });
    return this.toRolloutDto(rollout, targets);
  }

  private async dispatchNextTarget(rolloutId: string): Promise<void> {
    const rollout = await this.findRolloutEntityOrFail(rolloutId);
    if (rollout.status === 'cancelled') {
      return;
    }

    const activeCount = await this.targetsRepository.count({
      where: AGENT_UPDATE_TARGET_ACTIVE_STATUSES.map((status) => ({
        rolloutId: rollout.id,
        status,
      })),
    });

    if (activeCount > 0) {
      return;
    }

    const nextTarget = await this.targetsRepository.findOne({
      where: {
        rolloutId: rollout.id,
        status: 'pending',
      },
      order: {
        sequence: 'ASC',
      },
    });

    if (!nextTarget) {
      await this.rolloutsRepository.save({
        ...rollout,
        status: 'completed',
        statusMessage: 'Rollout finished. No pending targets remain.',
        completedAt: rollout.completedAt ?? new Date(),
      });
      return;
    }

    let node: NodeEntity;
    try {
      node = await this.nodesService.ensureExists(nextTarget.nodeId);
      this.assertNodeEligibleForRollout(node, rollout.targetVersion);
    } catch (error) {
      await this.pauseRolloutForTargetFailure(
        rollout,
        nextTarget,
        error instanceof Error
          ? error.message
          : `${nextTarget.nodeNameSnapshot} can no longer accept the selected agent update.`,
      );
      return;
    }

    const task = await this.tasksService.create(
      {
        nodeId: node.id,
        type: TASK_TYPES.AGENT_UPDATE,
        payload: {
          targetVersion: rollout.targetVersion,
          targetId: nextTarget.id,
          rollback: rollout.rollback,
        },
      },
      undefined,
      undefined,
    );

    await this.targetsRepository.save({
      ...nextTarget,
      status: 'dispatched',
      progressPercent: 5,
      statusMessage: `Queued update task ${task.id} for ${node.name || node.hostname}.`,
      taskId: task.id,
      dispatchedAt: new Date(),
      completedAt: null,
    });

    await this.rolloutsRepository.save({
      ...rollout,
      status: 'running',
      statusMessage: `Dispatched ${node.name || node.hostname}. Waiting for agent update progress.`,
      startedAt: rollout.startedAt ?? new Date(),
    });

    await this.recordRolloutEvent(
      node.id,
      SYSTEM_EVENT_TYPES.AGENT_UPDATE_TARGET_DISPATCHED,
      EventSeverity.INFO,
      `${node.name || node.hostname} queued agent ${rollout.rollback ? 'rollback' : 'update'} to ${rollout.targetVersion}.`,
      {
        rolloutId: rollout.id,
        targetId: nextTarget.id,
        taskId: task.id,
        targetVersion: rollout.targetVersion,
      },
    );
  }

  private async pauseRolloutForTargetFailure(
    rollout: AgentUpdateRolloutEntity,
    target: AgentUpdateRolloutTargetEntity,
    message: string,
  ): Promise<void> {
    const failedTarget = await this.targetsRepository.save({
      ...target,
      status: 'failed',
      completedAt: target.completedAt ?? new Date(),
      statusMessage: message,
    });

    await this.rolloutsRepository.save({
      ...rollout,
      status: 'paused',
      statusMessage: message,
    });

    await this.syncLinkedTaskTerminalState(
      failedTarget,
      TaskStatus.FAILED,
      message,
    );

    await this.recordRolloutEvent(
      failedTarget.nodeId,
      SYSTEM_EVENT_TYPES.AGENT_UPDATE_TARGET_FAILED,
      EventSeverity.WARNING,
      message,
      {
        rolloutId: rollout.id,
        targetId: failedTarget.id,
        targetVersion: failedTarget.targetVersion,
      },
    );
  }

  private assertNodeEligibleForRollout(
    node: NodeEntity,
    targetVersion: string,
  ): void {
    if (node.status !== 'online') {
      throw new BadRequestException(
        `Node ${node.hostname} must be online before it can be updated.`,
      );
    }
    this.nodesService.assertNodeAcceptingNewWork(node);

    if (!SUPPORTED_ARCHES.has(node.arch)) {
      throw new BadRequestException(
        `Node ${node.hostname} uses unsupported architecture ${node.arch}.`,
      );
    }

    if (node.agentVersion === targetVersion) {
      throw new BadRequestException(
        `Node ${node.hostname} is already running agent ${targetVersion}.`,
      );
    }
  }

  private async assertNoActiveRolloutExists(): Promise<void> {
    const count = await this.rolloutsRepository.count({
      where: [
        { status: 'queued' },
        { status: 'running' },
        { status: 'paused' },
      ],
    });
    if (count > 0) {
      throw new ConflictException(
        'Finish, resume, or cancel the existing rollout before creating a new one.',
      );
    }
  }

  private async findPausedFailedTarget(
    rolloutId: string,
    targetId: string,
  ): Promise<{
    rollout: AgentUpdateRolloutEntity;
    target: AgentUpdateRolloutTargetEntity;
  }> {
    const rollout = await this.findRolloutEntityOrFail(rolloutId);
    if (rollout.status !== 'paused') {
      throw new ConflictException(
        'Target retry and skip are available only when the rollout is paused.',
      );
    }

    const target = await this.findTargetEntityOrFail(targetId);
    if (target.rolloutId !== rollout.id) {
      throw new ConflictException(
        'The target does not belong to this rollout.',
      );
    }

    if (target.status !== 'failed') {
      throw new ConflictException(
        'Only failed targets can be retried or skipped.',
      );
    }

    return {
      rollout,
      target,
    };
  }

  private async countOutdatedNodes(targetVersion: string): Promise<number> {
    return this.nodesRepository
      .createQueryBuilder('node')
      .where('node."agentVersion" IS DISTINCT FROM :targetVersion', {
        targetVersion,
      })
      .getCount();
  }

  private async countEligibleOutdatedNodes(
    targetVersion: string,
  ): Promise<number> {
    return this.nodesRepository
      .createQueryBuilder('node')
      .where('node.status = :status', { status: 'online' })
      .andWhere('node."maintenanceMode" = false')
      .andWhere('node.arch IN (:...arches)', {
        arches: Array.from(SUPPORTED_ARCHES),
      })
      .andWhere('node."agentVersion" IS DISTINCT FROM :targetVersion', {
        targetVersion,
      })
      .getCount();
  }

  private async findRolloutEntityOrFail(
    id: string,
  ): Promise<AgentUpdateRolloutEntity> {
    const rollout = await this.rolloutsRepository.findOne({ where: { id } });
    if (!rollout) {
      throw new NotFoundException(`Agent update rollout ${id} was not found`);
    }

    return rollout;
  }

  private async findTargetEntityOrFail(
    id: string,
  ): Promise<AgentUpdateRolloutTargetEntity> {
    const target = await this.targetsRepository.findOne({ where: { id } });
    if (!target) {
      throw new NotFoundException(
        `Agent update rollout target ${id} was not found`,
      );
    }

    return target;
  }

  private toRolloutDto(
    rollout: AgentUpdateRolloutEntity,
    targets: AgentUpdateRolloutTargetEntity[],
  ): AgentUpdateRolloutDto {
    return {
      id: rollout.id,
      targetVersion: rollout.targetVersion,
      status: rollout.status,
      rollback: rollout.rollback,
      requestedByUserId: rollout.requestedByUserId,
      requestedByEmailSnapshot: rollout.requestedByEmailSnapshot,
      statusMessage: rollout.statusMessage,
      startedAt: rollout.startedAt?.toISOString() ?? null,
      completedAt: rollout.completedAt?.toISOString() ?? null,
      cancelledAt: rollout.cancelledAt?.toISOString() ?? null,
      counts: this.toCountsDto(targets),
      targets: targets.map((target) => this.toTargetDto(target)),
      createdAt: rollout.createdAt.toISOString(),
      updatedAt: rollout.updatedAt.toISOString(),
    };
  }

  private toCountsDto(
    targets: AgentUpdateRolloutTargetEntity[],
  ): AgentUpdateRolloutCountsDto {
    return {
      total: targets.length,
      completed: targets.filter((target) => target.status === 'completed')
        .length,
      failed: targets.filter((target) => target.status === 'failed').length,
      skipped: targets.filter((target) => target.status === 'skipped').length,
      active: targets.filter((target) =>
        (
          AGENT_UPDATE_TARGET_ACTIVE_STATUSES as readonly AgentUpdateTargetStatus[]
        ).includes(target.status),
      ).length,
      pending: targets.filter((target) => target.status === 'pending').length,
    };
  }

  private toTargetDto(
    target: AgentUpdateRolloutTargetEntity,
  ): AgentUpdateRolloutTargetDto {
    return {
      id: target.id,
      rolloutId: target.rolloutId,
      nodeId: target.nodeId,
      workspaceId: target.workspaceId,
      teamId: target.teamId,
      nodeNameSnapshot: target.nodeNameSnapshot,
      previousVersion: target.previousVersion,
      targetVersion: target.targetVersion,
      status: target.status,
      progressPercent: target.progressPercent,
      statusMessage: target.statusMessage,
      taskId: target.taskId,
      sequence: target.sequence,
      dispatchedAt: target.dispatchedAt?.toISOString() ?? null,
      completedAt: target.completedAt?.toISOString() ?? null,
      createdAt: target.createdAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
    };
  }

  private async setRolloutStatus(
    rollout: AgentUpdateRolloutEntity,
    status: AgentUpdateRolloutStatus,
    statusMessage: string,
    extra?: Partial<AgentUpdateRolloutEntity>,
  ): Promise<AgentUpdateRolloutEntity> {
    return this.rolloutsRepository.save({
      ...rollout,
      ...extra,
      status,
      statusMessage,
    });
  }

  private isTargetTerminal(status: AgentUpdateTargetStatus): boolean {
    return (
      AGENT_UPDATE_TARGET_TERMINAL_STATUSES as readonly AgentUpdateTargetStatus[]
    ).includes(status);
  }

  private async loadFailedTasksById(
    targets: AgentUpdateRolloutTargetEntity[],
  ): Promise<Map<string, TaskEntity>> {
    const taskIds = Array.from(
      new Set(
        targets
          .map((target) => target.taskId)
          .filter((taskId): taskId is string => Boolean(taskId)),
      ),
    );

    if (!taskIds.length) {
      return new Map();
    }

    const failedTasks = await this.tasksRepository.find({
      where: {
        id: In(taskIds),
        status: In([TaskStatus.FAILED, TaskStatus.CANCELLED]),
      },
    });

    return new Map(failedTasks.map((task) => [task.id, task]));
  }

  private resolveTargetTimeoutThresholdMs(
    status: AgentUpdateTargetStatus,
  ): number {
    switch (status) {
      case 'dispatched':
        return 2 * 60 * 1000;
      case 'waiting_for_reconnect':
        return 5 * 60 * 1000;
      default:
        return 15 * 60 * 1000;
    }
  }

  private buildTaskFailureMessage(
    target: AgentUpdateRolloutTargetEntity,
    task: TaskEntity,
  ): string {
    const detail = this.extractTaskFailureDetail(task);
    const baseMessage = `${target.nodeNameSnapshot} update task ${task.id} ${task.status} before detached updater progress was received.`;

    if (!detail) {
      return baseMessage;
    }

    return `${baseMessage} ${detail}`;
  }

  private extractTaskFailureDetail(task: TaskEntity): string | null {
    const output = typeof task.output === 'string' ? task.output.trim() : '';
    if (output) {
      return `Last task output: ${this.truncateTaskFailureDetail(output)}.`;
    }

    const error =
      typeof task.result?.['error'] === 'string'
        ? task.result['error'].trim()
        : '';
    if (error) {
      return `Reported error: ${this.truncateTaskFailureDetail(error)}.`;
    }

    const message =
      typeof task.result?.['message'] === 'string'
        ? task.result['message'].trim()
        : '';
    if (message) {
      return `Reported message: ${this.truncateTaskFailureDetail(message)}.`;
    }

    return null;
  }

  private truncateTaskFailureDetail(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 240) {
      return normalized;
    }

    return `${normalized.slice(0, 237)}...`;
  }

  private async recordRolloutEvent(
    nodeId: string | null,
    type: string,
    severity: EventSeverity,
    message: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!nodeId) {
      return;
    }

    await this.eventsService.record({
      nodeId,
      type,
      severity,
      message,
      metadata,
    });
  }

  private async requestTaskCancellationForTarget(
    target: AgentUpdateRolloutTargetEntity,
  ): Promise<void> {
    if (!target.taskId) {
      return;
    }

    try {
      await this.tasksService.requestTaskCancellation(
        target.taskId,
        {
          reason: 'Rollout cancelled by operator.',
        },
        target.workspaceId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to request cancellation for rollout target ${target.id} task ${target.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async syncLinkedTaskTerminalState(
    target: Pick<AgentUpdateRolloutTargetEntity, 'id' | 'taskId'>,
    status: TaskStatus.SUCCESS | TaskStatus.FAILED,
    detail: string,
  ): Promise<void> {
    if (!target.taskId) {
      return;
    }

    const linkedTask = await this.tasksRepository.findOne({
      where: { id: target.taskId },
    });
    if (!linkedTask || this.isTaskTerminalStatus(linkedTask.status)) {
      return;
    }

    const finishedAt = new Date();
    await this.tasksRepository.save({
      ...linkedTask,
      status,
      finishedAt: linkedTask.finishedAt ?? finishedAt,
      leaseUntil: null,
      claimedBy: null,
      claimToken: null,
      output: linkedTask.output ?? detail,
      result: {
        ...(linkedTask.result ?? {}),
        source: 'agent-update-rollout-monitor',
        detail,
      },
    });
  }

  private isTaskTerminalStatus(status: TaskStatus): boolean {
    return (
      status === TaskStatus.SUCCESS ||
      status === TaskStatus.FAILED ||
      status === TaskStatus.CANCELLED
    );
  }
}
