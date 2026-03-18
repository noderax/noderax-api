import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RedisService } from '../../redis/redis.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodesService } from '../nodes/nodes.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AppendTaskLogDto } from './dto/append-task-log.dto';
import {
  AGENT_TASK_TERMINAL_STATUSES,
  CompleteAgentTaskDto,
} from './dto/complete-agent-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { PullAgentTasksDto } from './dto/pull-agent-tasks.dto';
import { QueryTaskLogsDto } from './dto/query-task-logs.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { StartAgentTaskDto } from './dto/start-agent-task.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskLogLevel } from './entities/task-log-level.enum';
import { TaskEntity } from './entities/task.entity';
import { TaskStatus } from './entities/task-status.enum';

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(TaskLogEntity)
    private readonly taskLogsRepository: Repository<TaskLogEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<TaskEntity> {
    const node = await this.nodesService.ensureExists(createTaskDto.nodeId);

    const task = this.tasksRepository.create({
      nodeId: createTaskDto.nodeId,
      type: createTaskDto.type,
      payload: createTaskDto.payload ?? {},
      status: TaskStatus.QUEUED,
      result: null,
      output: null,
      startedAt: null,
      finishedAt: null,
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
    await this.redisService.publish(PUBSUB_CHANNELS.TASKS_CREATED, {
      taskId: savedTask.id,
      nodeId: savedTask.nodeId,
      status: savedTask.status,
    });

    return savedTask;
  }

  async findAll(query: QueryTasksDto): Promise<TaskEntity[]> {
    const tasksQuery = this.tasksRepository
      .createQueryBuilder('task')
      .orderBy('task.createdAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    if (query.nodeId) {
      tasksQuery.andWhere('task.nodeId = :nodeId', { nodeId: query.nodeId });
    }

    if (query.status) {
      tasksQuery.andWhere('task.status = :status', { status: query.status });
    }

    return tasksQuery.getMany();
  }

  async findOneOrFail(id: string): Promise<TaskEntity> {
    const task = await this.tasksRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task ${id} was not found`);
    }

    return task;
  }

  async findLogs(
    taskId: string,
    query: QueryTaskLogsDto,
  ): Promise<TaskLogEntity[]> {
    await this.findOneOrFail(taskId);

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

  private isTerminalStatus(status: TaskStatus): boolean {
    return TERMINAL_TASK_STATUSES.has(status);
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
    completeAgentTaskDto: CompleteAgentTaskDto,
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
}
