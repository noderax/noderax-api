import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { UserEntity } from '../users/entities/user.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateBatchScheduledTaskDto } from './dto/create-batch-scheduled-task.dto';
import { CreateScheduledTaskDto } from './dto/create-scheduled-task.dto';
import { UpdateScheduledTaskDto } from './dto/update-scheduled-task.dto';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import {
  computeNextScheduledRun,
  describeScheduledTask,
  SCHEDULED_TASK_RUNNER_LEASE_MS,
} from './scheduled-task.utils';
import { TasksService } from './tasks.service';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly tasksService: TasksService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(
    ownerUserId: string,
    workspaceId: string | undefined,
    createScheduledTaskDto: CreateScheduledTaskDto,
  ): Promise<ScheduledTaskEntity> {
    const owner = await this.findOwnerOrFail(ownerUserId);
    const workspace = await this.resolveWorkspace(workspaceId, ownerUserId);
    const normalized = this.normalizeScheduleInput(createScheduledTaskDto);
    const [saved] = await this.createSchedulesForNodes(
      owner,
      workspace,
      [createScheduledTaskDto.nodeId],
      normalized,
    );

    return saved;
  }

  async createBatch(
    ownerUserId: string,
    workspaceId: string | undefined,
    createBatchScheduledTaskDto: CreateBatchScheduledTaskDto,
  ): Promise<ScheduledTaskEntity[]> {
    const owner = await this.findOwnerOrFail(ownerUserId);
    const workspace = await this.resolveWorkspace(workspaceId, ownerUserId);
    const normalized = this.normalizeScheduleInput(createBatchScheduledTaskDto);

    return this.createSchedulesForNodes(
      owner,
      workspace,
      createBatchScheduledTaskDto.nodeIds,
      normalized,
    );
  }

  async findAll(workspaceId?: string): Promise<ScheduledTaskEntity[]> {
    const schedules = await this.scheduledTasksRepository
      .createQueryBuilder('schedule')
      .where(
        workspaceId ? 'schedule.workspaceId = :workspaceId' : '1=1',
        workspaceId ? { workspaceId } : {},
      )
      .orderBy('schedule.enabled', 'DESC')
      .addOrderBy('schedule.nextRunAt', 'ASC', 'NULLS LAST')
      .addOrderBy('schedule.createdAt', 'ASC')
      .getMany();

    return this.populateOwnerMetadata(schedules);
  }

  async findOneOrFail(
    id: string,
    workspaceId?: string,
  ): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.scheduledTasksRepository.findOne({
      where: workspaceId ? { id, workspaceId } : { id },
    });

    if (!scheduledTask) {
      throw new NotFoundException(`Scheduled task ${id} was not found`);
    }

    const [decoratedSchedule] = await this.populateOwnerMetadata([
      scheduledTask,
    ]);
    return decoratedSchedule;
  }

  async updateEnabled(
    id: string,
    dto: UpdateScheduledTaskDto,
    workspaceId?: string,
  ): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.findOneOrFail(id, workspaceId);
    scheduledTask.enabled = dto.enabled;
    scheduledTask.claimToken = null;
    scheduledTask.claimedBy = null;
    scheduledTask.leaseUntil = null;

    if (dto.enabled) {
      scheduledTask.nextRunAt = computeNextScheduledRun(
        scheduledTask,
        new Date(),
      );
    } else {
      scheduledTask.nextRunAt = null;
    }

    const saved = await this.scheduledTasksRepository.save(scheduledTask);
    saved.ownerName = scheduledTask.ownerName ?? null;
    saved.isLegacy = saved.timezoneSource === 'legacy_fixed';

    await this.eventsService.record({
      nodeId: saved.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_UPDATED,
      severity: EventSeverity.INFO,
      message: dto.enabled
        ? `Scheduled task ${saved.name} enabled. ${describeScheduledTask(saved)}`
        : `Scheduled task ${saved.name} disabled.`,
      metadata: {
        scheduleId: saved.id,
        scheduleName: saved.name,
        enabled: saved.enabled,
        ownerUserId: saved.ownerUserId,
        timezone: saved.timezone,
        nextRunAt: saved.nextRunAt?.toISOString() ?? null,
      },
    });

    return saved;
  }

  async delete(
    id: string,
    workspaceId?: string,
  ): Promise<{ deleted: true; id: string }> {
    const scheduledTask = await this.findOneOrFail(id, workspaceId);
    await this.scheduledTasksRepository.remove(scheduledTask);

    await this.eventsService.record({
      nodeId: scheduledTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_DELETED,
      severity: EventSeverity.WARNING,
      message: `Scheduled task ${scheduledTask.name} deleted.`,
      metadata: {
        scheduleId: scheduledTask.id,
        scheduleName: scheduledTask.name,
      },
    });

    return {
      deleted: true,
      id,
    };
  }

  async claimNextDueSchedule(
    claimedBy: string,
  ): Promise<ScheduledTaskEntity | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SCHEDULED_TASK_RUNNER_LEASE_MS);
    const claimToken = randomUUID();

    const updateResult = await this.scheduledTasksRepository
      .createQueryBuilder()
      .update(ScheduledTaskEntity)
      .set({
        claimedBy,
        claimToken,
        leaseUntil,
        updatedAt: now,
      })
      .where(
        `id = (
          SELECT s.id
          FROM scheduled_tasks s
          WHERE s.enabled = true
            AND s."nextRunAt" IS NOT NULL
            AND s."nextRunAt" <= :now
            AND (
              s."leaseUntil" IS NULL
              OR s."leaseUntil" <= :now
            )
          ORDER BY s."nextRunAt" ASC, s."createdAt" ASC
          LIMIT 1
        )`,
      )
      .setParameters({ now })
      .returning('*')
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      return null;
    }

    const row = updateResult.raw?.[0] as ScheduledTaskEntity | undefined;
    if (row?.id) {
      return row;
    }

    return this.scheduledTasksRepository.findOne({
      where: { claimToken },
    });
  }

  async triggerClaimedSchedule(
    scheduledTask: ScheduledTaskEntity,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const createdTask = await this.tasksService.createScheduledShellTask({
        nodeId: scheduledTask.nodeId,
        workspaceId: scheduledTask.workspaceId,
        scheduleId: scheduledTask.id,
        scheduleName: scheduledTask.name,
        command: scheduledTask.command,
      });

      const nextRunAt = scheduledTask.nextRunAt
        ? computeNextScheduledRun(scheduledTask, scheduledTask.nextRunAt)
        : computeNextScheduledRun(scheduledTask, new Date());

      await this.scheduledTasksRepository.update(
        {
          id: scheduledTask.id,
          claimToken: scheduledTask.claimToken,
        },
        {
          lastRunAt: new Date(),
          lastRunTaskId: createdTask.id,
          lastError: null,
          nextRunAt,
          claimToken: null,
          claimedBy: null,
          leaseUntil: null,
        },
      );

      await this.eventsService.record({
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_TRIGGERED,
        severity: EventSeverity.INFO,
        message: `Scheduled task ${scheduledTask.name} queued a shell.exec run.`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          taskId: createdTask.id,
          timezone: scheduledTask.timezone,
          nextRunAt: nextRunAt.toISOString(),
        },
      });

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown schedule error';

      this.logger.warn(
        `Scheduled task ${scheduledTask.id} failed to queue task: ${message}`,
      );

      await this.scheduledTasksRepository.update(
        {
          id: scheduledTask.id,
          claimToken: scheduledTask.claimToken,
        },
        {
          lastError: message,
          claimToken: null,
          claimedBy: null,
          leaseUntil: null,
        },
      );

      await this.eventsService.record({
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_FAILED,
        severity: EventSeverity.WARNING,
        message: `Scheduled task ${scheduledTask.name} failed to queue a run: ${message}`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          error: message,
        },
      });

      return {
        ok: false,
        error: message,
      };
    }
  }

  private async populateOwnerMetadata(
    schedules: ScheduledTaskEntity[],
  ): Promise<ScheduledTaskEntity[]> {
    const ownerIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.ownerUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const owners =
      ownerIds.length > 0
        ? ((await this.usersRepository.find({
            where: {
              id: In(ownerIds),
            },
          })) ?? [])
        : [];
    const ownerLookup = new Map(owners.map((owner) => [owner.id, owner]));

    return schedules.map((schedule) => {
      const owner = schedule.ownerUserId
        ? ownerLookup.get(schedule.ownerUserId)
        : null;
      schedule.ownerName = owner?.name ?? null;
      schedule.isLegacy = schedule.timezoneSource === 'legacy_fixed';
      return schedule;
    });
  }

  private normalizeScheduleInput(
    input: ScheduledTaskInputShape,
  ): NormalizedScheduleInput {
    const name = input.name.trim();
    const command = input.command.trim();

    if (name.length < 2) {
      throw new BadRequestException(
        'Schedule name must be at least 2 characters.',
      );
    }

    if (!command) {
      throw new BadRequestException('Command must not be empty.');
    }

    if (input.cadence === 'minutely') {
      if (
        input.hour !== undefined ||
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Minutely schedules do not accept hour, dayOfWeek, or intervalMinutes values.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: 0,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.cadence === 'custom') {
      if (input.intervalMinutes === undefined) {
        throw new BadRequestException(
          'Custom schedules require an intervalMinutes value.',
        );
      }

      if (input.hour !== undefined || input.dayOfWeek !== undefined) {
        throw new BadRequestException(
          'Custom schedules do not accept hour or dayOfWeek values.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: 0,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: input.intervalMinutes,
      };
    }

    if (input.cadence === 'hourly') {
      if (
        input.hour !== undefined ||
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Hourly schedules accept only the minute field.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: input.minute,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.cadence === 'daily') {
      if (input.hour === undefined) {
        throw new BadRequestException('Daily schedules require an hour value.');
      }
      if (
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Daily schedules do not accept dayOfWeek or intervalMinutes values.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: input.minute,
        hour: input.hour,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.hour === undefined || input.dayOfWeek === undefined) {
      throw new BadRequestException(
        'Weekly schedules require both hour and dayOfWeek values.',
      );
    }

    if (input.intervalMinutes !== undefined) {
      throw new BadRequestException(
        'Weekly schedules do not accept an intervalMinutes value.',
      );
    }

    return {
      name,
      command,
      cadence: input.cadence,
      minute: input.minute,
      hour: input.hour,
      dayOfWeek: input.dayOfWeek,
      intervalMinutes: null,
    };
  }

  private async findOwnerOrFail(ownerUserId: string): Promise<UserEntity> {
    const owner = await this.usersRepository.findOne({
      where: { id: ownerUserId },
    });

    if (!owner) {
      throw new NotFoundException(`User ${ownerUserId} was not found`);
    }

    return owner;
  }

  private async createSchedulesForNodes(
    owner: UserEntity,
    workspace: Awaited<ReturnType<WorkspacesService['findWorkspaceOrFail']>>,
    rawNodeIds: string[],
    normalized: NormalizedScheduleInput,
  ): Promise<ScheduledTaskEntity[]> {
    const nodeIds = this.normalizeNodeIds(rawNodeIds);
    await Promise.all(
      nodeIds.map((nodeId) =>
        this.nodesService.ensureExists(nodeId, workspace.id),
      ),
    );

    const now = new Date();
    const nextRunAt = computeNextScheduledRun(
      {
        ...normalized,
        timezone: workspace.defaultTimezone,
      },
      now,
    );
    const schedules: ScheduledTaskEntity[] = [];

    for (const nodeId of nodeIds) {
      const scheduledTask = this.scheduledTasksRepository.create({
        workspaceId: workspace.id,
        nodeId,
        ownerUserId: owner.id,
        name: normalized.name,
        command: normalized.command,
        cadence: normalized.cadence,
        minute: normalized.minute,
        hour: normalized.hour,
        dayOfWeek: normalized.dayOfWeek,
        intervalMinutes: normalized.intervalMinutes,
        timezone: workspace.defaultTimezone,
        timezoneSource: 'workspace',
        enabled: true,
        nextRunAt,
        lastRunAt: null,
        lastRunTaskId: null,
        lastError: null,
        leaseUntil: null,
        claimedBy: null,
        claimToken: null,
      });

      const saved = await this.scheduledTasksRepository.save(scheduledTask);
      saved.ownerName = owner.name;
      saved.isLegacy = false;

      await this.eventsService.record({
        nodeId: saved.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_CREATED,
        severity: EventSeverity.INFO,
        message: `Scheduled task ${saved.name} created. ${describeScheduledTask(saved)}`,
        metadata: {
          scheduleId: saved.id,
          scheduleName: saved.name,
          cadence: saved.cadence,
          ownerUserId: saved.ownerUserId,
          ownerName: owner.name,
          workspaceId: saved.workspaceId,
          timezone: saved.timezone,
          nextRunAt: saved.nextRunAt?.toISOString() ?? null,
        },
      });

      schedules.push(saved);
    }

    return schedules;
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

  private async resolveWorkspace(
    workspaceId: string | undefined,
    ownerUserId: string,
  ) {
    if (workspaceId) {
      return this.workspacesService.findWorkspaceOrFail(workspaceId);
    }

    const defaultWorkspace =
      await this.workspacesService.getDefaultWorkspaceOrFail();
    const membership = await this.workspacesService.findMembershipForUser(
      defaultWorkspace.id,
      ownerUserId,
    );

    if (!membership) {
      throw new NotFoundException(
        `User ${ownerUserId} is not a member of the default workspace.`,
      );
    }

    return defaultWorkspace;
  }
}

type ScheduledTaskInputShape =
  | Pick<
      CreateScheduledTaskDto,
      | 'name'
      | 'command'
      | 'cadence'
      | 'minute'
      | 'hour'
      | 'dayOfWeek'
      | 'intervalMinutes'
    >
  | Pick<
      CreateBatchScheduledTaskDto,
      | 'name'
      | 'command'
      | 'cadence'
      | 'minute'
      | 'hour'
      | 'dayOfWeek'
      | 'intervalMinutes'
    >;

type NormalizedScheduleInput = {
  name: string;
  command: string;
  cadence: ScheduledTaskEntity['cadence'];
  minute: number;
  hour: number | null;
  dayOfWeek: number | null;
  intervalMinutes: number | null;
};
