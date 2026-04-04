import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Brackets, Repository } from 'typeorm';
import {
  isPackageTaskType,
  TASK_TYPES,
} from '../../common/constants/task-types.constants';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { RedisService } from '../../redis/redis.service';
import { AuthenticatedAgent } from '../../common/types/authenticated-agent.type';
import { AgentRealtimeService } from '../agent-realtime/agent-realtime.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodesService } from '../nodes/nodes.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AgentTaskAcceptedHttpDto } from './dto/agent-task-accepted-http.dto';
import {
  AgentTaskCompletedHttpDto,
  HTTP_TASK_OUTPUT_MAX_LENGTH,
} from './dto/agent-task-completed-http.dto';
import { AgentTaskLogHttpDto } from './dto/agent-task-log-http.dto';
import { AgentTaskStartedHttpDto } from './dto/agent-task-started-http.dto';
import { AppendTaskLogDto } from './dto/append-task-log.dto';
import { ClaimAgentTaskResponseDto } from './dto/claim-agent-task-response.dto';
import { ClaimAgentTasksDto } from './dto/claim-agent-tasks.dto';
import { CompleteAgentTaskDto } from './dto/complete-agent-task.dto';
import { CreateBatchTaskDto } from './dto/create-batch-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { PullAgentTasksDto } from './dto/pull-agent-tasks.dto';
import { QueryTaskLogsDto } from './dto/query-task-logs.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { RequestTaskCancelDto } from './dto/request-task-cancel.dto';
import { StartAgentTaskDto } from './dto/start-agent-task.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskLogLevel } from './entities/task-log-level.enum';
import { TaskEntity } from './entities/task.entity';
import { TaskTemplateEntity } from './entities/task-template.entity';
import { TaskStatus } from './entities/task-status.enum';
import {
  NormalizedPackageDto,
  NormalizedPackageSearchResultDto,
  NormalizedPackageTaskResult,
} from './types/package-task-result.type';

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

const CLAIM_POLL_INTERVAL_MS = 500;
const ROOT_SCOPE_TASK = 'task';
const ROOT_SCOPE_OPERATIONAL = 'operational';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly counters = new Map<string, number>();
  private lastClaimAt: Date | null = null;

  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(TaskLogEntity)
    private readonly taskLogsRepository: Repository<TaskLogEntity>,
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplatesRepository: Repository<TaskTemplateEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
    private readonly agentRealtimeService: AgentRealtimeService,
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(
    createTaskDto: CreateTaskDto,
    workspaceId?: string,
    context?: import('../../common/types/request-audit-context.type').RequestAuditContext,
  ): Promise<TaskEntity> {
    return this.queueTask(
      {
        nodeId: createTaskDto.nodeId,
        type: createTaskDto.type,
        payload: createTaskDto.payload ?? {},
        workspaceId,
        templateId: createTaskDto.templateId,
      },
      undefined,
      context,
    );
  }

  async createBatch(
    createBatchTaskDto: CreateBatchTaskDto,
    workspaceId?: string,
    context?: import('../../common/types/request-audit-context.type').RequestAuditContext,
  ): Promise<TaskEntity[]> {
    const nodeIds = this.normalizeNodeIds(createBatchTaskDto.nodeIds);
    const nodeLookup = await this.loadNodeLookup(nodeIds, workspaceId);
    const tasks: TaskEntity[] = [];

    for (const nodeId of nodeIds) {
      const node = nodeLookup.get(nodeId);

      if (!node) {
        throw new NotFoundException(`Node ${nodeId} was not found`);
      }

      tasks.push(
        await this.queueTask(
          {
            nodeId,
            type: createBatchTaskDto.type,
            payload: createBatchTaskDto.payload ?? {},
            workspaceId,
            templateId: createBatchTaskDto.templateId,
          },
          node,
          context,
        ),
      );
    }

    return tasks;
  }

  async createScheduledShellTask(input: {
    nodeId: string;
    scheduleId: string;
    scheduleName: string;
    command: string;
    runAsRoot?: boolean;
    workspaceId?: string;
    targetTeamId?: string | null;
    targetTeamName?: string | null;
    templateId?: string | null;
    templateName?: string | null;
  }): Promise<TaskEntity> {
    return this.queueTask({
      nodeId: input.nodeId,
      type: 'shell.exec',
      workspaceId: input.workspaceId,
      targetTeamId: input.targetTeamId ?? null,
      targetTeamName: input.targetTeamName ?? null,
      templateId: input.templateId ?? null,
      templateName: input.templateName ?? null,
      payload: {
        title: input.scheduleName,
        command: input.command,
        runAsRoot: Boolean(input.runAsRoot),
        ...(input.runAsRoot ? { rootScope: 'task' } : {}),
        scheduleId: input.scheduleId,
        scheduleName: input.scheduleName,
      },
    });
  }

  async createForTeam(
    input: {
      workspaceId: string;
      teamId: string;
      type: string;
      payload: Record<string, unknown>;
      templateId?: string;
    },
    context?: import('../../common/types/request-audit-context.type').RequestAuditContext,
  ): Promise<TaskEntity[]> {
    const workspace = await this.workspacesService.assertWorkspaceWritable(
      input.workspaceId,
    );
    const team = await this.workspacesService.findTeamOrFail(
      workspace.id,
      input.teamId,
    );
    const template = input.templateId
      ? await this.resolveTemplateOrFail(input.templateId, workspace.id)
      : null;
    const nodes = (
      await this.nodesService.listTeamOwnedNodes(workspace.id, team.id)
    ).filter((node) => !node.maintenanceMode);

    if (nodes.length === 0) {
      throw new BadRequestException(
        `Team ${team.name} does not currently have any eligible nodes.`,
      );
    }

    const payload =
      Object.keys(input.payload).length > 0
        ? input.payload
        : (template?.payloadTemplate ?? {});
    const type = input.type.trim() || template?.taskType;

    if (!type) {
      throw new BadRequestException('Task type is required.');
    }

    const tasks: TaskEntity[] = [];
    for (const node of nodes) {
      tasks.push(
        await this.queueTask(
          {
            nodeId: node.id,
            type,
            payload,
            workspaceId: workspace.id,
            targetTeamId: team.id,
            targetTeamName: team.name,
            templateId: template?.id ?? null,
            templateName: template?.name ?? null,
          },
          node,
          context,
        ),
      );
    }

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: workspace.id,
      action: 'task.team-run.created',
      targetType: 'team',
      targetId: team.id,
      targetLabel: team.name,
      metadata: {
        taskType: type,
        taskCount: tasks.length,
        taskIds: tasks.map((task) => task.id),
      },
      context,
    });

    return tasks;
  }

  async findAll(
    query: QueryTasksDto,
    workspaceId?: string,
  ): Promise<TaskEntity[]> {
    const tasksQuery = this.tasksRepository
      .createQueryBuilder('task')
      .orderBy('task.createdAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    if (workspaceId) {
      tasksQuery.andWhere('task.workspaceId = :workspaceId', { workspaceId });
    }

    if (query.nodeId) {
      tasksQuery.andWhere('task.nodeId = :nodeId', { nodeId: query.nodeId });
    }

    if (query.status) {
      tasksQuery.andWhere('task.status = :status', { status: query.status });
    }

    return tasksQuery.getMany();
  }

  async failStaleTasks(input: {
    queuedTimeoutSeconds: number;
    runningTimeoutSeconds: number;
  }): Promise<number> {
    const now = new Date();
    const requeuedClaimedCount = await this.requeueExpiredLeases(now);
    const queuedDeadline = new Date(
      now.getTime() - Math.max(input.queuedTimeoutSeconds, 5) * 1000,
    );
    const runningDeadline = new Date(
      now.getTime() - Math.max(input.runningTimeoutSeconds, 10) * 1000,
    );

    const staleTasks = await this.tasksRepository
      .createQueryBuilder('task')
      .innerJoin('nodes', 'node', 'node.id = task."nodeId"')
      .where(
        new Brackets((builder) => {
          builder
            .where(
              new Brackets((queuedBuilder) => {
                queuedBuilder
                  .where('task.status = :queuedStatus', {
                    queuedStatus: TaskStatus.QUEUED,
                  })
                  .andWhere('task.createdAt <= :queuedDeadline', {
                    queuedDeadline,
                  })
                  .andWhere('node."maintenanceMode" = false');
              }),
            )
            .orWhere(
              new Brackets((runningBuilder) => {
                runningBuilder
                  .where('task.status = :runningStatus', {
                    runningStatus: TaskStatus.RUNNING,
                  })
                  .andWhere('task.startedAt IS NOT NULL')
                  .andWhere('task.startedAt <= :runningDeadline', {
                    runningDeadline,
                  });
              }),
            );
        }),
      )
      .getMany();

    if (staleTasks.length === 0) {
      return requeuedClaimedCount;
    }

    for (const task of staleTasks) {
      const previousStatus = task.status;
      task.status = TaskStatus.FAILED;
      task.finishedAt = now;
      task.leaseUntil = null;
      task.claimedBy = null;
      task.claimToken = null;
      task.result = {
        ...(task.result ?? {}),
        reason: 'stale-timeout',
        previousStatus,
      };

      if (!task.output?.trim()) {
        task.output =
          previousStatus === TaskStatus.QUEUED
            ? 'Task timed out in queue before being started by an agent.'
            : 'Task timed out while running on agent.';
      }

      const savedTask = await this.tasksRepository.save(task);
      await this.publishTaskUpdated(savedTask);
    }

    return staleTasks.length + requeuedClaimedCount;
  }

  async findOneOrFail(id: string, workspaceId?: string): Promise<TaskEntity> {
    const task = await this.tasksRepository.findOne({
      where: workspaceId ? { id, workspaceId } : { id },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} was not found`);
    }

    return task;
  }

  async waitForTerminalState(
    taskId: string,
    timeoutMs = 10000,
    pollMs = 250,
    workspaceId?: string,
  ): Promise<TaskEntity | null> {
    const deadline = Date.now() + Math.max(timeoutMs, 0);
    let task = await this.findOneOrFail(taskId, workspaceId);

    if (this.isTerminalStatus(task.status)) {
      return task;
    }

    while (Date.now() < deadline) {
      await this.delay(Math.max(pollMs, 1));
      task = await this.findOneOrFail(taskId, workspaceId);

      if (this.isTerminalStatus(task.status)) {
        return task;
      }
    }

    return null;
  }

  async requestTaskCancellation(
    taskId: string,
    dto: RequestTaskCancelDto,
    workspaceId?: string,
  ): Promise<TaskEntity> {
    const task = await this.findOneOrFail(taskId, workspaceId);
    await this.workspacesService.assertWorkspaceWritable(task.workspaceId);
    const previousStatus = task.status;
    const now = new Date();
    const normalizedReason =
      dto.reason && dto.reason.trim().length > 0 ? dto.reason.trim() : null;

    if (this.isTerminalStatus(task.status)) {
      return task;
    }

    task.cancelRequestedAt = now;
    task.cancelReason = normalizedReason;

    if (
      task.status === TaskStatus.QUEUED ||
      task.status === TaskStatus.ACCEPTED ||
      task.status === TaskStatus.CLAIMED
    ) {
      task.status = TaskStatus.CANCELLED;
      task.finishedAt = now;
      task.leaseUntil = null;
      task.claimToken = null;
      task.claimedBy = null;
      task.result = {
        ...(task.result ?? {}),
        reason: 'cancel-requested-before-run',
        cancelledAt: now.toISOString(),
        cancelReason: normalizedReason,
      };
      if (!task.output) {
        task.output = normalizedReason
          ? `Task cancelled before running: ${normalizedReason}`
          : 'Task cancelled before running by operator';
      }
    }

    const savedTask = await this.tasksRepository.save(task);
    await this.publishTaskUpdated(savedTask);

    if (
      savedTask.status === TaskStatus.CANCELLED ||
      savedTask.status === TaskStatus.RUNNING
    ) {
      await this.createTaskLog(savedTask.id, {
        level: TaskLogLevel.INFO,
        message: normalizedReason
          ? `Cancellation requested: ${normalizedReason}`
          : 'Cancellation requested by operator',
      });
    }

    if (savedTask.status === TaskStatus.CANCELLED) {
      const node = await this.nodesService.findOneOrFail(
        savedTask.nodeId,
        savedTask.workspaceId,
      );
      await this.eventsService.record({
        nodeId: savedTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_CANCELLED,
        severity: EventSeverity.WARNING,
        message: this.getTaskCompletionMessage(savedTask, node),
        metadata: {
          ...this.buildTaskEventMetadata(savedTask),
          result: savedTask.result,
        },
      });
    }

    this.logger.log(
      JSON.stringify({
        msg: 'task.cancel.requested',
        taskId: savedTask.id,
        nodeId: savedTask.nodeId,
        previousStatus,
        status: savedTask.status,
        cancelRequestedAt: savedTask.cancelRequestedAt?.toISOString() ?? null,
      }),
    );

    return savedTask;
  }

  async getTaskControlForAgent(
    taskId: string,
    agent: AuthenticatedAgent,
  ): Promise<{
    taskId: string;
    status: TaskStatus;
    cancelRequested: boolean;
    cancelRequestedAt: string | null;
    cancelReason: string | null;
  }> {
    const task = await this.findTaskForNodeOrFail(taskId, agent.nodeId);
    const cancelRequested =
      task.status === TaskStatus.RUNNING && Boolean(task.cancelRequestedAt);

    return {
      taskId: task.id,
      status: task.status,
      cancelRequested,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null,
      cancelReason: task.cancelReason,
    };
  }

  handlePackageResult(task: TaskEntity): NormalizedPackageTaskResult | null {
    if (!isPackageTaskType(task.type)) {
      return null;
    }

    switch (task.type) {
      case TASK_TYPES.PACKAGE_LIST: {
        const packages = this.readStructuredPackageCollection(
          task.result,
          'packages',
        );

        if (!packages) {
          return null;
        }

        return {
          operation: TASK_TYPES.PACKAGE_LIST,
          packages,
        };
      }
      case TASK_TYPES.PACKAGE_SEARCH: {
        const results =
          this.readStructuredSearchCollection(task.result, 'results') ??
          this.readStructuredSearchCollection(task.result, 'packages');

        if (!results) {
          return null;
        }

        return {
          operation: TASK_TYPES.PACKAGE_SEARCH,
          results,
        };
      }
      case TASK_TYPES.PACKAGE_INSTALL:
      case TASK_TYPES.PACKAGE_REMOVE:
      case TASK_TYPES.PACKAGE_PURGE:
        return {
          operation: task.type,
          names: this.resolvePackageNames(task),
          purge: this.resolvePurge(task),
          output:
            task.output ??
            this.readStringFromRecord(task.result, ['output', 'message']),
        };
      default:
        return null;
    }
  }

  async findLogs(
    taskId: string,
    query: QueryTaskLogsDto,
    workspaceId?: string,
  ): Promise<TaskLogEntity[]> {
    await this.findOneOrFail(taskId, workspaceId);

    return this.taskLogsRepository.find({
      where: { taskId },
      order: { createdAt: 'ASC' },
      take: query.limit ?? 100,
    });
  }

  async pullQueuedForAgent(
    pullAgentTasksDto: PullAgentTasksDto,
  ): Promise<TaskEntity[]> {
    await this.nodesService.authenticateAgent(
      pullAgentTasksDto.nodeId,
      pullAgentTasksDto.agentToken,
    );

    return this.tasksRepository.find({
      where: {
        nodeId: pullAgentTasksDto.nodeId,
        status: TaskStatus.QUEUED,
      },
      order: {
        createdAt: 'ASC',
      },
      take: pullAgentTasksDto.limit ?? 10,
    });
  }

  async findQueuedForNode(nodeId: string, limit = 50): Promise<TaskEntity[]> {
    return this.tasksRepository.find({
      where: {
        nodeId,
        status: TaskStatus.QUEUED,
      },
      order: {
        createdAt: 'ASC',
      },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async claimForAgent(
    agent: AuthenticatedAgent,
    claimDto: ClaimAgentTasksDto,
  ): Promise<ClaimAgentTaskResponseDto> {
    await this.nodesService.findOneOrFail(agent.nodeId);
    await this.nodesService.recordAgentRootAccessState(
      agent.nodeId,
      claimDto.rootAccess ?? null,
    );
    this.lastClaimAt = new Date();
    const startedAt = Date.now();
    const waitMs = Math.max(claimDto.waitMs ?? 15000, 0);
    const deadline = Date.now() + waitMs;
    this.incrementCounter('claim_request_total');

    this.logger.log(
      JSON.stringify({
        msg: 'task.claim.request',
        nodeId: agent.nodeId,
        taskId: null,
        transition: 'queued->accepted',
        status: 'pending',
        result: {
          maxTasks: claimDto.maxTasks ?? 1,
          waitMs,
          capabilities: claimDto.capabilities ?? [],
        },
        latency: 0,
      }),
    );

    try {
      while (true) {
        const task = await this.claimNextTaskOnce(
          agent.nodeId,
          claimDto.capabilities,
        );
        if (task) {
          this.incrementCounter('claim_success_total');
          this.logger.log(
            JSON.stringify({
              msg: 'task.claim.response',
              taskId: task.id,
              nodeId: agent.nodeId,
              transition: 'queued->accepted',
              status: 'success',
              result: 'task-assigned',
              latency: Date.now() - startedAt,
            }),
          );
          return {
            task,
            outputTruncated: Boolean(task.outputTruncated),
            rootAccess: await this.loadDesiredRootAccessSnapshot(agent.nodeId),
          };
        }

        if (Date.now() >= deadline) {
          this.incrementCounter('claim_empty_total');
          this.logger.log(
            JSON.stringify({
              msg: 'task.claim.response',
              taskId: null,
              nodeId: agent.nodeId,
              transition: 'none',
              status: 'empty',
              result: 'no-task',
              latency: Date.now() - startedAt,
            }),
          );
          return {
            task: null,
            outputTruncated: false,
            rootAccess: await this.loadDesiredRootAccessSnapshot(agent.nodeId),
          };
        }

        await this.delay(CLAIM_POLL_INTERVAL_MS);
      }
    } catch (error) {
      this.incrementCounter('claim_error_total');
      this.logger.error(
        JSON.stringify({
          msg: 'task.claim.response',
          taskId: null,
          nodeId: agent.nodeId,
          transition: 'none',
          status: 'error',
          result: error instanceof Error ? error.message : String(error),
          latency: Date.now() - startedAt,
        }),
      );
      throw error;
    }
  }

  private async loadDesiredRootAccessSnapshot(nodeId: string) {
    const node = await this.nodesService.findOneOrFail(nodeId);
    return this.nodesService.buildDesiredRootAccessSnapshot(node);
  }

  recordClaimUnauthorizedAttempt(input: {
    path: string;
    method: string;
    reason: string;
  }): void {
    if (!this.isAgentClaimPath(input.path, input.method)) {
      return;
    }

    this.incrementCounter('claim_unauthorized_total');
  }

  getClaimStatsSnapshot(): Record<string, number> {
    return {
      claim_request_total: this.counters.get('claim_request_total') ?? 0,
      claim_success_total: this.counters.get('claim_success_total') ?? 0,
      claim_empty_total: this.counters.get('claim_empty_total') ?? 0,
      claim_unauthorized_total:
        this.counters.get('claim_unauthorized_total') ?? 0,
      claim_error_total: this.counters.get('claim_error_total') ?? 0,
    };
  }

  getLastClaimAtIso(): string | null {
    return this.lastClaimAt ? this.lastClaimAt.toISOString() : null;
  }

  async getQueueSnapshot(): Promise<{ queued: number; running: number }> {
    const rows = await this.tasksRepository
      .createQueryBuilder('task')
      .select('task.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('task.status IN (:...statuses)', {
        statuses: [TaskStatus.QUEUED, TaskStatus.RUNNING],
      })
      .groupBy('task.status')
      .getRawMany<{ status: TaskStatus; count: string | number }>();

    let queued = 0;
    let running = 0;

    for (const row of rows) {
      const count =
        typeof row.count === 'number'
          ? row.count
          : Number.parseInt(row.count, 10) || 0;

      if (row.status === TaskStatus.QUEUED) {
        queued = count;
      } else if (row.status === TaskStatus.RUNNING) {
        running = count;
      }
    }

    return {
      queued,
      running,
    };
  }

  async acceptClaimedTaskForAgent(
    taskId: string,
    agent: AuthenticatedAgent,
    dto: AgentTaskAcceptedHttpDto,
  ): Promise<TaskLogEntity | { ok: true; duplicate: true; taskId: string }> {
    const startedAt = Date.now();
    this.assertTaskIdMatchesRoute(taskId, dto.taskId);

    this.logger.log(
      JSON.stringify({
        msg: 'task.lifecycle.accepted',
        taskId,
        nodeId: agent.nodeId,
        transition: 'accepted',
        status: 'received',
        result: 'request',
        latency: 0,
      }),
    );

    const task = await this.findTaskForNodeOrFail(taskId, agent.nodeId);
    if (this.isTerminalStatus(task.status)) {
      this.incrementCounter('duplicate_transition_total');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.accepted',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->accepted`,
        status: 'duplicate',
        result: 'duplicate-noop',
        latency: Date.now() - startedAt,
      });
      return { ok: true, duplicate: true, taskId };
    }

    if (
      task.status !== TaskStatus.ACCEPTED &&
      task.status !== TaskStatus.CLAIMED &&
      task.status !== TaskStatus.RUNNING
    ) {
      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.accepted',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->accepted`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} is in ${task.status} state and cannot be accepted`,
      });
      throw new ConflictException(
        `Task ${task.id} is in ${task.status} state and cannot be accepted`,
      );
    }

    if (task.status === TaskStatus.ACCEPTED) {
      this.incrementCounter('duplicate_transition_total');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.accepted',
        taskId,
        nodeId: agent.nodeId,
        transition: 'accepted->accepted',
        status: 'duplicate',
        result: 'duplicate-noop',
        latency: Date.now() - startedAt,
      });
      return { ok: true, duplicate: true, taskId };
    }

    if (task.status === TaskStatus.RUNNING) {
      this.incrementCounter('duplicate_transition_total');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.accepted',
        taskId,
        nodeId: agent.nodeId,
        transition: 'running->accepted',
        status: 'duplicate',
        result: 'duplicate-noop',
        latency: Date.now() - startedAt,
      });
      return { ok: true, duplicate: true, taskId };
    }

    this.assertClaimOwnership(task, agent.nodeId, 'accepted');

    const taskLog = this.taskLogsRepository.create({
      taskId,
      level: TaskLogLevel.INFO,
      message: 'Task accepted by agent',
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
    });

    const saved = await this.taskLogsRepository.save(taskLog);
    this.logLifecycleTransition({
      msg: 'task.lifecycle.accepted',
      taskId,
      nodeId: agent.nodeId,
      transition: `${task.status}->accepted`,
      status: 'success',
      result: 'ok',
      latency: Date.now() - startedAt,
    });
    return saved;
  }

  async startClaimedTaskForAgent(
    taskId: string,
    agent: AuthenticatedAgent,
    dto: AgentTaskStartedHttpDto,
  ): Promise<TaskEntity> {
    const startedAt = Date.now();
    this.assertTaskIdMatchesRoute(taskId, dto.taskId);

    this.logger.log(
      JSON.stringify({
        msg: 'task.lifecycle.started',
        taskId,
        nodeId: agent.nodeId,
        transition: 'started',
        status: 'received',
        result: 'request',
        latency: 0,
      }),
    );

    const task = await this.findTaskForNodeOrFail(taskId, agent.nodeId);
    if (task.status === TaskStatus.RUNNING) {
      this.incrementCounter('duplicate_transition_total');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.started',
        taskId,
        nodeId: agent.nodeId,
        transition: 'running->started',
        status: 'duplicate',
        result: 'duplicate-noop',
        latency: Date.now() - startedAt,
      });
      return task;
    }

    if (this.isTerminalStatus(task.status)) {
      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.started',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->started`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} is already ${task.status} and cannot be started`,
      });
      throw new ConflictException(
        `Task ${task.id} is already ${task.status} and cannot be started`,
      );
    }

    if (
      task.status !== TaskStatus.ACCEPTED &&
      task.status !== TaskStatus.CLAIMED
    ) {
      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.started',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->started`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} must be accepted before it can be started`,
      });
      throw new ConflictException(
        `Task ${task.id} must be accepted before it can be started`,
      );
    }

    this.assertClaimOwnership(task, agent.nodeId, 'started');

    const updateResult = await this.tasksRepository
      .createQueryBuilder()
      .update(TaskEntity)
      .set({
        status: TaskStatus.RUNNING,
        startedAt: dto.timestamp ? new Date(dto.timestamp) : new Date(),
        leaseUntil: null,
        claimToken: null,
        claimedBy: null,
        updatedAt: new Date(),
      })
      .where('id = :id', { id: taskId })
      .andWhere('nodeId = :nodeId', { nodeId: agent.nodeId })
      .andWhere('status IN (:...statuses)', {
        statuses: [TaskStatus.ACCEPTED, TaskStatus.CLAIMED],
      })
      .andWhere('claimedBy = :claimedBy', { claimedBy: agent.nodeId })
      .execute();

    if (updateResult.affected === 0) {
      this.incrementCounter('lifecycle_rejected_total.claim-lost');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.started',
        taskId,
        nodeId: agent.nodeId,
        transition: 'accepted->started',
        status: 'rejected',
        result: 'claim-lost',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} lease ownership was lost before start`,
      });
      throw new ConflictException(
        `Task ${task.id} claim ownership was lost before start`,
      );
    }

    const savedTask = await this.tasksRepository.findOneOrFail({
      where: { id: taskId },
    });

    await this.publishTaskUpdated(savedTask);
    this.logLifecycleTransition({
      msg: 'task.lifecycle.started',
      taskId,
      nodeId: agent.nodeId,
      transition: `${task.status}->started`,
      status: 'success',
      result: 'ok',
      latency: Date.now() - startedAt,
    });

    return savedTask;
  }

  async appendClaimedTaskLogForAgent(
    taskId: string,
    agent: AuthenticatedAgent,
    dto: AgentTaskLogHttpDto,
  ): Promise<TaskLogEntity> {
    const startedAt = Date.now();
    this.assertTaskIdMatchesRoute(taskId, dto.taskId);

    this.logger.log(
      JSON.stringify({
        msg: 'task.lifecycle.log',
        taskId,
        nodeId: agent.nodeId,
        transition: 'log',
        status: 'received',
        result: dto.stream,
        latency: 0,
      }),
    );

    const task = await this.findTaskForNodeOrFail(taskId, agent.nodeId);

    if (task.status !== TaskStatus.RUNNING) {
      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.log',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->log`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} is in ${task.status} state and cannot accept logs`,
      });
      throw new ConflictException(
        `Task ${task.id} is in ${task.status} state and cannot accept logs`,
      );
    }

    const taskLog = this.taskLogsRepository.create({
      taskId,
      level: this.resolveTaskLogLevel(dto.stream),
      message: dto.line,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
    });

    task.output = dto.line;
    await this.tasksRepository.save(task);

    const savedLog = await this.taskLogsRepository.save(taskLog);
    this.logLifecycleTransition({
      msg: 'task.lifecycle.log',
      taskId,
      nodeId: agent.nodeId,
      transition: 'running->log',
      status: 'success',
      result: 'ok',
      latency: Date.now() - startedAt,
    });
    return savedLog;
  }

  async completeClaimedTaskForAgent(
    taskId: string,
    agent: AuthenticatedAgent,
    dto: AgentTaskCompletedHttpDto,
  ): Promise<TaskEntity> {
    const startedAt = Date.now();
    this.assertTaskIdMatchesRoute(taskId, dto.taskId);
    const normalizedStatus = this.normalizeCompletionStatus(dto.status);

    this.logger.log(
      JSON.stringify({
        msg: 'task.lifecycle.completed',
        taskId,
        nodeId: agent.nodeId,
        transition: 'completed',
        status: 'received',
        result: dto.status,
        latency: 0,
      }),
    );

    const task = await this.findTaskForNodeOrFail(taskId, agent.nodeId);

    if (this.isTerminalStatus(task.status)) {
      if (task.status === normalizedStatus) {
        this.incrementCounter('duplicate_transition_total');
        this.logLifecycleTransition({
          msg: 'task.lifecycle.completed',
          taskId,
          nodeId: agent.nodeId,
          transition: `${task.status}->${dto.status}`,
          status: 'duplicate',
          result: 'duplicate-noop',
          latency: Date.now() - startedAt,
        });
        return task;
      }

      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.completed',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->${dto.status}`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} is already ${task.status} and cannot transition to ${dto.status}`,
      });
      throw new ConflictException(
        `Task ${task.id} is already ${task.status} and cannot transition to ${dto.status}`,
      );
    }

    if (
      task.status !== TaskStatus.CLAIMED &&
      task.status !== TaskStatus.RUNNING
    ) {
      this.incrementCounter('lifecycle_rejected_total.invalid-transition');
      this.logLifecycleTransition({
        msg: 'task.lifecycle.completed',
        taskId,
        nodeId: agent.nodeId,
        transition: `${task.status}->${dto.status}`,
        status: 'rejected',
        result: 'invalid-transition',
        latency: Date.now() - startedAt,
        validationErrorDetail: `Task ${task.id} is in ${task.status} state and cannot be completed`,
      });
      throw new ConflictException(
        `Task ${task.id} is in ${task.status} state and cannot be completed`,
      );
    }

    if (task.status === TaskStatus.CLAIMED) {
      this.assertClaimOwnership(task, agent.nodeId, 'completed');
    }

    const completionOutput = dto.output ?? dto.error;
    const { output: normalizedOutput, outputTruncated } =
      this.normalizeCompletionOutput(completionOutput);

    const now = new Date();
    const previousStatus = task.status;
    task.status = normalizedStatus;
    task.startedAt = task.startedAt ?? now;
    task.finishedAt = dto.timestamp ? new Date(dto.timestamp) : now;
    task.result =
      dto.result ??
      this.buildCompletionResult({
        ...dto,
        completedAt: dto.timestamp,
      });
    task.output = normalizedOutput ?? task.output;
    task.outputTruncated = outputTruncated;
    task.leaseUntil = null;
    task.claimedBy = null;
    task.claimToken = null;

    const savedTask = await this.tasksRepository.save(task);
    await this.publishTaskUpdated(savedTask);

    this.logLifecycleTransition({
      msg: 'task.lifecycle.completed',
      taskId,
      nodeId: agent.nodeId,
      transition: `${previousStatus}->${normalizedStatus}`,
      status: 'success',
      result: outputTruncated ? 'ok-truncated' : 'ok',
      latency: Date.now() - startedAt,
    });

    return savedTask;
  }

  async acknowledgeForAgent(
    taskId: string,
    input: { nodeId: string; agentToken: string; timestamp?: string },
  ): Promise<TaskLogEntity> {
    await this.nodesService.authenticateAgent(input.nodeId, input.agentToken);
    await this.findTaskForNodeOrFail(taskId, input.nodeId);

    const taskLog = this.taskLogsRepository.create({
      taskId,
      level: TaskLogLevel.INFO,
      message: 'Task accepted by agent',
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
    });

    return this.taskLogsRepository.save(taskLog);
  }

  async startForAgent(
    taskId: string,
    startAgentTaskDto: StartAgentTaskDto,
  ): Promise<TaskEntity> {
    this.assertTaskIdMatchesRoute(taskId, startAgentTaskDto.taskId);

    const node = await this.nodesService.authenticateAgent(
      startAgentTaskDto.nodeId,
      startAgentTaskDto.agentToken,
    );

    const updateResult = await this.tasksRepository
      .createQueryBuilder()
      .update(TaskEntity)
      .set({
        status: TaskStatus.RUNNING,
        startedAt: startAgentTaskDto.startedAt
          ? new Date(startAgentTaskDto.startedAt)
          : new Date(),
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where('id = :id', { id: taskId })
      .andWhere('nodeId = :nodeId', { nodeId: node.id })
      .andWhere('status = :status', { status: TaskStatus.QUEUED })
      .returning('*')
      .execute();

    if (updateResult.affected === 0) {
      const task = await this.tasksRepository.findOne({
        where: { id: taskId },
      });

      if (!task || task.nodeId !== node.id) {
        throw new NotFoundException(
          `Task ${taskId} was not found for this node`,
        );
      }

      if (task.status === TaskStatus.RUNNING) {
        return task;
      }

      throw new ConflictException(
        `Task ${taskId} is in ${task.status} state and cannot be started`,
      );
    }

    const savedTask = await this.tasksRepository.findOneOrFail({
      where: { id: taskId },
    });

    await this.eventsService.record({
      nodeId: savedTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_STARTED,
      severity: EventSeverity.INFO,
      message: `Task ${savedTask.type} started on node ${node.hostname}`,
      metadata: this.buildTaskEventMetadata(savedTask),
    });

    await this.publishTaskUpdated(savedTask);

    return savedTask;
  }

  async appendLogForAgent(
    taskId: string,
    appendTaskLogDto: AppendTaskLogDto,
  ): Promise<TaskLogEntity | TaskLogEntity[]> {
    this.assertTaskIdMatchesRoute(taskId, appendTaskLogDto.taskId);

    const node = await this.nodesService.authenticateAgent(
      appendTaskLogDto.nodeId,
      appendTaskLogDto.agentToken,
    );
    const task = await this.findTaskForNodeOrFail(taskId, node.id);

    if (task.status === TaskStatus.QUEUED) {
      throw new ConflictException(
        'Task must be started before logs can be appended',
      );
    }

    if (this.isTerminalStatus(task.status)) {
      throw new ConflictException(
        `Task ${task.id} is already ${task.status} and cannot accept more logs`,
      );
    }

    if (
      Array.isArray(appendTaskLogDto.entries) &&
      appendTaskLogDto.entries.length > 0
    ) {
      const entries = appendTaskLogDto.entries.filter(
        (entry) =>
          typeof entry.line === 'string' && entry.line.trim().length > 0,
      );

      if (entries.length === 0) {
        throw new BadRequestException(
          'entries must contain at least one log line',
        );
      }

      task.output = entries[entries.length - 1].line;
      await this.tasksRepository.save(task);

      const taskLogs = entries.map((entry) =>
        this.taskLogsRepository.create({
          taskId: task.id,
          level: this.resolveTaskLogLevel(entry.stream),
          message: entry.line,
          timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
        }),
      );

      return this.taskLogsRepository.save(taskLogs);
    }

    if (!appendTaskLogDto.message) {
      throw new BadRequestException('message is required');
    }

    task.output = appendTaskLogDto.message;
    await this.tasksRepository.save(task);

    const taskLog = this.taskLogsRepository.create({
      taskId: task.id,
      level: appendTaskLogDto.level ?? TaskLogLevel.INFO,
      message: appendTaskLogDto.message,
      timestamp: new Date(),
    });

    return this.taskLogsRepository.save(taskLog);
  }

  async completeForAgent(
    taskId: string,
    completeAgentTaskDto: CompleteAgentTaskDto,
  ): Promise<TaskEntity> {
    this.assertTaskIdMatchesRoute(taskId, completeAgentTaskDto.taskId);
    const normalizedStatus = this.normalizeCompletionStatus(
      completeAgentTaskDto.status,
    );

    const node = await this.nodesService.authenticateAgent(
      completeAgentTaskDto.nodeId,
      completeAgentTaskDto.agentToken,
    );
    const task = await this.findTaskForNodeOrFail(taskId, node.id);

    if (this.isTerminalStatus(task.status)) {
      if (task.status === normalizedStatus) {
        return task;
      }

      throw new ConflictException(
        `Task ${task.id} is already ${task.status} and cannot transition to ${completeAgentTaskDto.status}`,
      );
    }

    const now = new Date();
    const completionOutput =
      completeAgentTaskDto.output ?? completeAgentTaskDto.error;
    const completionResult =
      completeAgentTaskDto.result ??
      this.buildCompletionResult(completeAgentTaskDto);

    task.status = normalizedStatus;
    task.startedAt = task.startedAt ?? now;
    task.finishedAt = completeAgentTaskDto.completedAt
      ? new Date(completeAgentTaskDto.completedAt)
      : now;
    task.result = completionResult;
    if (completionOutput !== undefined) {
      task.output = completionOutput;
    }

    const savedTask = await this.tasksRepository.save(task);

    if (completionOutput) {
      await this.createTaskLog(savedTask.id, {
        level:
          savedTask.status === TaskStatus.FAILED
            ? TaskLogLevel.ERROR
            : TaskLogLevel.INFO,
        message: completionOutput,
      });
    }

    await this.eventsService.record({
      nodeId: savedTask.nodeId,
      type: this.getTaskCompletionEventType(savedTask.status),
      severity: this.getTaskCompletionSeverity(savedTask.status),
      message: this.getTaskCompletionMessage(savedTask, node),
      metadata: {
        ...this.buildTaskEventMetadata(savedTask),
        result: savedTask.result,
      },
    });

    await this.publishTaskUpdated(savedTask);

    return savedTask;
  }

  private async findTaskForNodeOrFail(
    taskId: string,
    nodeId: string,
  ): Promise<TaskEntity> {
    const task = await this.tasksRepository.findOne({
      where: { id: taskId, nodeId },
    });

    if (!task) {
      throw new NotFoundException(
        `Task ${taskId} was not found for node ${nodeId}`,
      );
    }

    return task;
  }

  private async publishTaskUpdated(task: TaskEntity): Promise<void> {
    this.realtimeGateway.emitTaskUpdated(
      task as unknown as Record<string, unknown>,
    );
    await this.redisService.publish(PUBSUB_CHANNELS.TASKS_UPDATED, {
      taskId: task.id,
      nodeId: task.nodeId,
      status: task.status,
      finishedAt: task.finishedAt?.toISOString() ?? null,
      updatedAt: task.updatedAt.toISOString(),
      sourceInstanceId: this.redisService.getInstanceId(),
    });
  }

  private async createTaskLog(
    taskId: string,
    input: { level: TaskLogLevel; message: string },
  ): Promise<TaskLogEntity> {
    const taskLog = this.taskLogsRepository.create({
      taskId,
      level: input.level,
      message: input.message,
      timestamp: new Date(),
    });

    return this.taskLogsRepository.save(taskLog);
  }

  private async queueTask(
    input: {
      nodeId: string;
      type: string;
      payload: Record<string, unknown>;
      workspaceId?: string;
      targetTeamId?: string | null;
      targetTeamName?: string | null;
      templateId?: string | null;
      templateName?: string | null;
    },
    nodeOverride?: NodeEntity,
    context?: import('../../common/types/request-audit-context.type').RequestAuditContext,
  ): Promise<TaskEntity> {
    const node =
      nodeOverride ??
      (await this.nodesService.ensureExists(input.nodeId, input.workspaceId));
    await this.workspacesService.assertWorkspaceWritable(node.workspaceId);
    this.nodesService.assertNodeAcceptingNewWork(node);
    this.assertRequestedRootAccessAllowed(node, input.type, input.payload);
    const template =
      input.templateId && !input.templateName
        ? await this.resolveTemplateOrFail(input.templateId, node.workspaceId)
        : null;

    const task = this.tasksRepository.create({
      workspaceId: node.workspaceId,
      nodeId: input.nodeId,
      type: input.type,
      payload: input.payload,
      targetTeamId: input.targetTeamId ?? null,
      templateId: input.templateId ?? template?.id ?? null,
      templateName: input.templateName ?? template?.name ?? null,
      status: TaskStatus.QUEUED,
      result: null,
      output: null,
      outputTruncated: false,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      cancelReason: null,
      leaseUntil: null,
      claimedBy: null,
      claimToken: null,
    });

    const savedTask = await this.tasksRepository.save(task);

    await this.eventsService.record({
      nodeId: savedTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_QUEUED,
      severity: EventSeverity.INFO,
      message: `Task ${savedTask.type} queued for node ${node.hostname}`,
      metadata: {
        taskId: savedTask.id,
        taskType: savedTask.type,
      },
    });

    this.realtimeGateway.emitTaskCreated(
      savedTask as unknown as Record<string, unknown>,
    );

    if (this.isRealtimeTaskDispatchEnabled()) {
      await this.agentRealtimeService.dispatchTaskToNode(savedTask);
    }

    await this.redisService.publish(PUBSUB_CHANNELS.TASKS_CREATED, {
      taskId: savedTask.id,
      nodeId: savedTask.nodeId,
      status: savedTask.status,
      sourceInstanceId: this.redisService.getInstanceId(),
    });

    if (context) {
      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId: node.workspaceId,
        action: 'task.created',
        targetType: 'task',
        targetId: savedTask.id,
        targetLabel: savedTask.type,
        metadata: {
          nodeId: savedTask.nodeId,
          hostname: node.hostname,
        },
        context,
      });
    }

    return savedTask;
  }

  private normalizeNodeIds(nodeIds: string[]): string[] {
    const normalizedNodeIds = Array.from(
      new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean)),
    );

    if (normalizedNodeIds.length === 0) {
      throw new BadRequestException('Select at least one node.');
    }

    return normalizedNodeIds;
  }

  private async loadNodeLookup(
    nodeIds: string[],
    workspaceId?: string,
  ): Promise<Map<string, NodeEntity>> {
    const nodes = await Promise.all(
      nodeIds.map((nodeId) =>
        this.nodesService.ensureExists(nodeId, workspaceId),
      ),
    );

    return new Map(nodes.map((node) => [node.id, node] as const));
  }

  private isTerminalStatus(status: TaskStatus): boolean {
    return TERMINAL_TASK_STATUSES.has(status);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getTaskCompletionEventType(status: TaskStatus): string {
    switch (status) {
      case TaskStatus.SUCCESS:
        return SYSTEM_EVENT_TYPES.TASK_COMPLETED;
      case TaskStatus.FAILED:
        return SYSTEM_EVENT_TYPES.TASK_FAILED;
      case TaskStatus.CANCELLED:
        return SYSTEM_EVENT_TYPES.TASK_CANCELLED;
      default:
        throw new ConflictException(`Task status ${status} is not terminal`);
    }
  }

  private getTaskCompletionSeverity(status: TaskStatus): EventSeverity {
    switch (status) {
      case TaskStatus.SUCCESS:
        return EventSeverity.INFO;
      case TaskStatus.FAILED:
      case TaskStatus.CANCELLED:
        return EventSeverity.WARNING;
      default:
        throw new ConflictException(`Task status ${status} is not terminal`);
    }
  }

  private getTaskCompletionMessage(task: TaskEntity, node: NodeEntity): string {
    switch (task.status) {
      case TaskStatus.SUCCESS:
        return `Task ${task.type} completed successfully on node ${node.hostname}`;
      case TaskStatus.FAILED:
        return `Task ${task.type} failed on node ${node.hostname}`;
      case TaskStatus.CANCELLED:
        return `Task ${task.type} was cancelled on node ${node.hostname}`;
      default:
        throw new ConflictException(
          `Task status ${task.status} is not terminal`,
        );
    }
  }

  private buildTaskEventMetadata(task: TaskEntity): Record<string, unknown> {
    return {
      taskId: task.id,
      taskType: task.type,
      taskStatus: task.status,
    };
  }

  private assertRequestedRootAccessAllowed(
    node: NodeEntity,
    taskType: string,
    payload: Record<string, unknown>,
  ): void {
    if (this.isPackageMutationTaskType(taskType)) {
      this.nodesService.assertNodeAllowsOperationalRoot(node);
      return;
    }

    if (taskType !== 'shell.exec') {
      return;
    }

    const rootRequest = this.readShellExecRootRequest(payload);
    if (!rootRequest.runAsRoot) {
      return;
    }

    if (rootRequest.rootScope === ROOT_SCOPE_TASK) {
      this.nodesService.assertNodeAllowsTaskRoot(node);
      return;
    }

    this.assertOperationalRootShellPayloadAllowed(rootRequest.command);
    this.nodesService.assertNodeAllowsOperationalRoot(node);
  }

  private readShellExecRootRequest(payload: Record<string, unknown>): {
    command: string | null;
    runAsRoot: boolean;
    rootScope: typeof ROOT_SCOPE_TASK | typeof ROOT_SCOPE_OPERATIONAL | null;
  } {
    const command =
      typeof payload.command === 'string' ? payload.command.trim() : null;
    const runAsRoot = payload.runAsRoot === true;

    if (!runAsRoot) {
      return {
        command,
        runAsRoot: false,
        rootScope: null,
      };
    }

    const rootScope =
      typeof payload.rootScope === 'string' ? payload.rootScope.trim() : null;

    if (
      rootScope !== ROOT_SCOPE_TASK &&
      rootScope !== ROOT_SCOPE_OPERATIONAL
    ) {
      throw new BadRequestException(
        'rootScope must be "task" or "operational" when runAsRoot is enabled.',
      );
    }

    return {
      command,
      runAsRoot: true,
      rootScope,
    };
  }

  private assertOperationalRootShellPayloadAllowed(command: string | null): void {
    const normalizedCommand = command?.replace(/\s+/g, ' ').trim() ?? '';
    const allowedCommands = new Set([
      'reboot',
      'systemctl restart noderax-agent',
      'apt-get update',
    ]);

    if (allowedCommands.has(normalizedCommand)) {
      return;
    }

    throw new BadRequestException(
      'Operational root access is limited to reboot, restarting noderax-agent, and apt-get update.',
    );
  }

  private isPackageMutationTaskType(taskType: string): boolean {
    return (
      taskType === TASK_TYPES.PACKAGE_INSTALL ||
      taskType === TASK_TYPES.PACKAGE_REMOVE ||
      taskType === TASK_TYPES.PACKAGE_PURGE
    );
  }

  private assertTaskIdMatchesRoute(
    routeTaskId: string,
    bodyTaskId?: string,
  ): void {
    if (bodyTaskId && bodyTaskId !== routeTaskId) {
      throw new BadRequestException(
        'taskId in request body must match route parameter',
      );
    }
  }

  private resolveTaskLogLevel(stream: string): TaskLogLevel {
    switch (stream) {
      case TaskLogLevel.STDOUT:
        return TaskLogLevel.STDOUT;
      case TaskLogLevel.STDERR:
        return TaskLogLevel.STDERR;
      default:
        return TaskLogLevel.INFO;
    }
  }

  private normalizeCompletionStatus(
    status: CompleteAgentTaskDto['status'],
  ): TaskStatus {
    switch (status) {
      case TaskStatus.SUCCESS:
        return TaskStatus.SUCCESS;
      case TaskStatus.CANCELLED:
      case 'canceled':
        return TaskStatus.CANCELLED;
      case 'timeout':
      case TaskStatus.FAILED:
        return TaskStatus.FAILED;
      default:
        throw new ConflictException(`Task status ${status} is not terminal`);
    }
  }

  private buildCompletionResult(
    completeAgentTaskDto: Pick<
      CompleteAgentTaskDto,
      'exitCode' | 'durationMs' | 'completedAt' | 'error' | 'status'
    >,
  ): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};

    if (completeAgentTaskDto.exitCode !== undefined) {
      result.exitCode = completeAgentTaskDto.exitCode;
    }
    if (completeAgentTaskDto.durationMs !== undefined) {
      result.durationMs = completeAgentTaskDto.durationMs;
    }
    if (completeAgentTaskDto.completedAt !== undefined) {
      result.completedAt = completeAgentTaskDto.completedAt;
    }
    if (completeAgentTaskDto.error !== undefined) {
      result.error = completeAgentTaskDto.error;
    }
    if (completeAgentTaskDto.status === 'timeout') {
      result.reason = 'timeout';
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  private async claimNextTaskOnce(
    nodeId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _capabilities?: string[],
  ): Promise<TaskEntity | null> {
    const now = new Date();
    const leaseUntil = new Date(
      now.getTime() + this.getClaimLeaseSeconds() * 1000,
    );
    const claimToken = randomUUID();

    const updateResult = await this.tasksRepository
      .createQueryBuilder()
      .update(TaskEntity)
      .set({
        status: TaskStatus.ACCEPTED,
        claimedBy: nodeId,
        claimToken,
        leaseUntil,
        updatedAt: now,
      })
      .where(
        `id = (
          SELECT t.id
          FROM tasks t
          INNER JOIN nodes n ON n.id = t."nodeId"
          WHERE t."nodeId" = :nodeId
            AND t."cancelRequestedAt" IS NULL
            AND n."maintenanceMode" = false
            AND (
              t.status = :queuedStatus
              OR (
                t.status IN (:...leasedStatuses)
                AND t."leaseUntil" IS NOT NULL
                AND t."leaseUntil" <= :now
              )
            )
          ORDER BY t."createdAt" ASC
          LIMIT 1
        )`,
      )
      .setParameters({
        nodeId,
        queuedStatus: TaskStatus.QUEUED,
        leasedStatuses: [TaskStatus.ACCEPTED, TaskStatus.CLAIMED],
        now,
      })
      .returning('*')
      .execute();

    if (updateResult.affected === 0) {
      return null;
    }

    const row = updateResult.raw?.[0] as TaskEntity | undefined;
    if (row?.id) {
      return row;
    }

    return this.tasksRepository.findOne({
      where: {
        claimToken,
      },
    });
  }

  private async requeueExpiredLeases(now: Date): Promise<number> {
    const updateResult = await this.tasksRepository
      .createQueryBuilder()
      .update(TaskEntity)
      .set({
        status: TaskStatus.QUEUED,
        leaseUntil: null,
        claimToken: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(
        `"id" IN (
          SELECT t.id
          FROM "tasks" t
          INNER JOIN "nodes" n ON n.id = t."nodeId"
          WHERE t.status IN (:...statuses)
            AND t."leaseUntil" IS NOT NULL
            AND t."leaseUntil" <= :now
            AND n."maintenanceMode" = false
        )`,
      )
      .setParameters({
        statuses: [TaskStatus.ACCEPTED, TaskStatus.CLAIMED],
        now,
      })
      .execute();

    const requeuedCount = updateResult.affected ?? 0;
    if (requeuedCount > 0) {
      this.incrementCounter('task_stale_requeue_total', requeuedCount);
    }

    return requeuedCount;
  }

  private assertClaimOwnership(
    task: TaskEntity,
    nodeId: string,
    transition: string,
  ): void {
    if (task.claimedBy !== nodeId) {
      this.incrementCounter('lifecycle_rejected_total.claim-owner-mismatch');
      throw new ConflictException(
        `Task ${task.id} is claimed by a different node and cannot transition to ${transition}`,
      );
    }

    if (!task.leaseUntil || task.leaseUntil.getTime() <= Date.now()) {
      this.incrementCounter('lifecycle_rejected_total.lease-expired');
      throw new ConflictException(
        `Task ${task.id} lease expired before ${transition} transition`,
      );
    }
  }

  private normalizeCompletionOutput(output: string | undefined): {
    output?: string;
    outputTruncated: boolean;
  } {
    if (output === undefined) {
      return {
        output: undefined,
        outputTruncated: false,
      };
    }

    if (output.length <= HTTP_TASK_OUTPUT_MAX_LENGTH) {
      return {
        output,
        outputTruncated: false,
      };
    }

    return {
      output: output.slice(0, HTTP_TASK_OUTPUT_MAX_LENGTH),
      outputTruncated: true,
    };
  }

  private getClaimLeaseSeconds(): number {
    const config =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    return Math.max(config.taskClaimLeaseSeconds, 15);
  }

  private isRealtimeTaskDispatchEnabled(): boolean {
    const config =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    return Boolean(config.enableRealtimeTaskDispatch);
  }

  private incrementCounter(counterName: string, count = 1): void {
    this.counters.set(
      counterName,
      (this.counters.get(counterName) ?? 0) + count,
    );
  }

  private logLifecycleTransition(input: {
    msg: string;
    taskId: string;
    nodeId: string;
    transition: string;
    status: string;
    result: string;
    latency: number;
    validationErrorDetail?: string;
  }): void {
    this.logger.log(
      JSON.stringify({
        msg: input.msg,
        taskId: input.taskId,
        nodeId: input.nodeId,
        transition: input.transition,
        status: input.status,
        result: input.result,
        latency: input.latency,
        validationErrorDetail: input.validationErrorDetail,
      }),
    );
  }

  private readStructuredPackageCollection(
    result: Record<string, unknown> | null,
    key: string,
  ): NormalizedPackageDto[] | null {
    if (!result || !Array.isArray(result[key])) {
      return null;
    }

    return (result[key] as unknown[])
      .map((entry) => this.normalizePackageRecord(entry))
      .filter((entry): entry is NormalizedPackageDto => entry !== null);
  }

  private readStructuredSearchCollection(
    result: Record<string, unknown> | null,
    key: string,
  ): NormalizedPackageSearchResultDto[] | null {
    if (!result || !Array.isArray(result[key])) {
      return null;
    }

    return (result[key] as unknown[])
      .map((entry) => this.normalizeSearchRecord(entry))
      .filter(
        (entry): entry is NormalizedPackageSearchResultDto => entry !== null,
      );
  }

  private normalizePackageRecord(value: unknown): NormalizedPackageDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const name = this.readStringFromRecord(value, ['name', 'package']);

    if (!name) {
      return null;
    }

    return {
      name,
      version: this.readStringFromRecord(value, ['version']),
      architecture: this.readStringFromRecord(value, ['architecture', 'arch']),
      description: this.readStringFromRecord(value, ['description', 'summary']),
    };
  }

  private normalizeSearchRecord(
    value: unknown,
  ): NormalizedPackageSearchResultDto | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const name = this.readStringFromRecord(value, ['name', 'package']);

    if (!name) {
      return null;
    }

    return {
      name,
      version: this.readStringFromRecord(value, ['version']),
      description: this.readStringFromRecord(value, ['description', 'summary']),
    };
  }

  private resolvePackageNames(task: TaskEntity): string[] {
    const resultNames = this.readStringArray(task.result, 'names');

    if (resultNames) {
      return resultNames;
    }

    const payloadNames = this.readStringArray(task.payload, 'names');

    if (payloadNames) {
      return payloadNames;
    }

    const singularName =
      this.readStringFromRecord(task.result, ['name', 'package']) ??
      this.readStringFromRecord(task.payload, ['name', 'package']);

    return singularName ? [singularName] : [];
  }

  private resolvePurge(task: TaskEntity): boolean {
    if (task.type === TASK_TYPES.PACKAGE_PURGE) {
      return true;
    }

    return (
      this.readBooleanFromRecord(task.result, ['purge']) ??
      this.readBooleanFromRecord(task.payload, ['purge']) ??
      false
    );
  }

  private readStringArray(
    record: Record<string, unknown> | null,
    key: string,
  ): string[] | null {
    if (!record || !Array.isArray(record[key])) {
      return null;
    }

    return (record[key] as unknown[]).filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    );
  }

  private readStringFromRecord(
    record: Record<string, unknown> | null,
    keys: string[],
  ): string | null {
    if (!record) {
      return null;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private readBooleanFromRecord(
    record: Record<string, unknown> | null,
    keys: string[],
  ): boolean | null {
    if (!record) {
      return null;
    }

    for (const key of keys) {
      if (typeof record[key] === 'boolean') {
        return record[key] as boolean;
      }
    }

    return null;
  }

  private isAgentClaimPath(path: string, method: string): boolean {
    const normalizedMethod = method.trim().toUpperCase();
    if (normalizedMethod !== 'POST') {
      return false;
    }

    const normalizedPath = path.trim().toLowerCase();
    return (
      normalizedPath === '/agent/tasks/claim' ||
      normalizedPath.endsWith('/agent/tasks/claim')
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private async resolveTemplateOrFail(
    templateId: string,
    workspaceId: string,
  ): Promise<TaskTemplateEntity> {
    const template = await this.taskTemplatesRepository.findOne({
      where: {
        id: templateId,
        workspaceId,
      },
    });

    if (!template) {
      throw new NotFoundException(`Task template ${templateId} was not found`);
    }

    return template;
  }
}
